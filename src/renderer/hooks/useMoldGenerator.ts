import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Axis, MoldBoxShape } from '../types';
import { autoDetectPlane as autoDetectPlaneImpl } from '../mold/generateMold';
import { exportSTL, exportOBJ, export3MF } from '../mold/exporters';
import {
  collectTransferables,
  deserializeGeometry,
  type WorkerRequest,
  type WorkerResponse,
} from '../mold/workerProtocol';

// Re-export for App.tsx, which uses EXPLODE_OFFSET_RATIO in getExplodeOffset().
export { EXPLODE_OFFSET_RATIO } from '../mold/constants';

/**
 * `useMoldGenerator` is a thin React wrapper around the mold-building
 * functions in `../mold/`. CSG work runs in a dedicated Web Worker so the
 * UI stays responsive during generation (generate can take multiple seconds
 * on detailed meshes).
 *
 * Notes for callers:
 *   • `generateMold` returns a Promise that resolves with reconstructed
 *     BufferGeometries. The worker owns a single Manifold WASM instance
 *     for the hook's lifetime.
 *   • `autoDetectPlane` stays on the main thread — it's pure JS math over
 *     the position buffer and completes in milliseconds.
 *   • Errors surfaced from the worker preserve the original message
 *     (e.g., "model may not be watertight") so callers can display them.
 */
export function useMoldGenerator() {
  // One worker per hook instance. Lazily created on first use so we don't
  // pay the WASM-init cost for users who open the app but never generate.
  const workerRef = useRef<Worker | null>(null);

  // Request correlation: multiple concurrent generate() calls would be
  // ambiguous otherwise. In practice the UI prevents this, but the id
  // makes debugging a mis-routed response straightforward.
  const requestIdRef = useRef(0);

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      // Vite-native worker spawn: `new Worker(new URL(...), { type: 'module' })`.
      // Vite sees this pattern and bundles moldWorker.ts + its imports (three,
      // manifold-3d, generateMold) as a separate chunk loaded off-thread.
      workerRef.current = new Worker(
        new URL('../mold/moldWorker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    return workerRef.current;
  }, []);

  // Terminate the worker on unmount so the WASM heap + the whole module
  // tree gets GC'd. Without this, strict-mode double-mount would leak a
  // worker per remount in dev.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const generateMold = useCallback(
    async (
      geometry: THREE.BufferGeometry,
      boundingBox: THREE.Box3,
      axis: Axis,
      offset: number,
      options: {
        wallThicknessRatio?: number;
        clearanceRatio?: number;
        moldBoxShape?: MoldBoxShape;
      } = {},
    ): Promise<{ top: THREE.BufferGeometry; bottom: THREE.BufferGeometry }> => {
      const worker = getWorker();
      const id = ++requestIdRef.current;

      // Serialize geometry attributes up-front. We clone so the original
      // BufferGeometry (still referenced by the R3F scene) is untouched —
      // transferring `.array.buffer` directly would detach it and cause
      // the live preview mesh to go blank.
      const positionAttr = geometry.attributes.position;
      if (!positionAttr) {
        throw new Error('Geometry has no position attribute.');
      }
      const positions = new Float32Array(positionAttr.array as Float32Array);
      const index = geometry.index
        ? new Uint32Array(geometry.index.array as Uint16Array | Uint32Array)
        : undefined;

      const req: WorkerRequest = {
        type: 'generate',
        id,
        payload: {
          positions,
          index,
          bboxMin: [boundingBox.min.x, boundingBox.min.y, boundingBox.min.z],
          bboxMax: [boundingBox.max.x, boundingBox.max.y, boundingBox.max.z],
          axis,
          offset,
          wallThicknessRatio: options.wallThicknessRatio,
          clearanceRatio: options.clearanceRatio,
          moldBoxShape: options.moldBoxShape,
        },
      };

      return new Promise((resolve, reject) => {
        const onMessage = (ev: MessageEvent<WorkerResponse>) => {
          const res = ev.data;
          // Ignore stale responses from superseded requests.
          if (res.id !== id) return;
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);

          if (res.type === 'error') {
            reject(new Error(res.message));
            return;
          }

          resolve({
            top: deserializeGeometry(res.payload.top),
            bottom: deserializeGeometry(res.payload.bottom),
          });
        };

        const onError = (ev: ErrorEvent) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          reject(new Error(ev.message || 'Mold worker crashed'));
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage(req, collectTransferables(req));
      });
    },
    [getWorker],
  );

  const autoDetectPlane = useCallback(autoDetectPlaneImpl, []);

  /**
   * Export mold halves to various formats.
   *
   * Scale handling: the CSG pipeline always produces 1:1 geometry. If the
   * user has applied a print-scale (Auto-scale-to-printer feature), we bake
   * it into a CLONE of each half before serialization so the original
   * geometry in App state is left untouched (changing scale mid-session
   * should not mutate the displayed mold). A scale of 1.0 is a common
   * fast-path and skips the clone entirely.
   */
  const exportFiles = useCallback(async (
    topGeo: THREE.BufferGeometry,
    bottomGeo: THREE.BufferGeometry,
    fileName: string,
    format: 'stl' | 'obj' | '3mf',
    scale: number = 1.0,
  ) => {
    const baseName = (fileName.replace(/\.[^.]+$/, '') || 'mold');

    /**
     * Produce a geometry to export — either the original (at scale 1) or a
     * scaled clone. Uniform scale only; non-uniform would break wall-thickness
     * assumptions and produce molds with uneven walls.
     *
     * Why clone: applyMatrix4 mutates. We don't want the STL export to
     * permanently modify the geometry currently rendered in the viewport,
     * especially because the viewport uses a <group scale> wrapper which
     * would then stack the scaling and halve the model visually.
     */
    const prepareForExport = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
      if (scale === 1.0) return geo;
      const clone = geo.clone();
      clone.applyMatrix4(new THREE.Matrix4().makeScale(scale, scale, scale));
      return clone;
    };

    const exportGeometry = async (geo: THREE.BufferGeometry, suffix: string) => {
      const exportGeo = prepareForExport(geo);
      let data: ArrayBuffer;

      try {
        switch (format) {
          case 'stl':
            data = exportSTL(exportGeo);
            break;
          case 'obj':
            data = exportOBJ(exportGeo);
            break;
          case '3mf':
            data = await export3MF(exportGeo);
            break;
          default:
            data = exportSTL(exportGeo);
        }

        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_${suffix}.${format}`;
        a.click();
        // Delay revocation: `a.click()` starts the download but Safari/Firefox
        // variants may not have captured the blob by the time the microtask
        // returns. 2s is conservative — the URL is cheap to hold.
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } finally {
        // Free the scaled clone's GPU buffers (the 1.0 fast-path returns the
        // original geo which is still owned by the caller — don't dispose it).
        if (exportGeo !== geo) exportGeo.dispose();
      }
    };

    await exportGeometry(topGeo, 'top');
    // Browsers block rapid successive downloads — small delay between them
    await new Promise(resolve => setTimeout(resolve, 500));
    await exportGeometry(bottomGeo, 'bottom');
  }, []);

  return { generateMold, exportFiles, autoDetectPlane };
}

// Re-export the Axis type for backward compat with anything importing it from here.
export type { Axis };
