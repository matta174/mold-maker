/// <reference lib="webworker" />
import * as THREE from 'three';
import { generateMold } from './generateMold';
import {
  deserializeGeometry,
  serializeGeometry,
  collectResultTransferables,
  type WorkerRequest,
  type WorkerResponse,
} from './workerProtocol';

/**
 * Dedicated worker that runs Manifold CSG off the UI thread.
 *
 * Why: generateMold can hang for several seconds on complex models —
 * enough to trigger "page unresponsive" dialogs in Chromium. Moving it
 * here keeps the React render loop smooth and lets the three.js preview
 * (orbit, camera drag) stay responsive during generation.
 *
 * Lifetime: one worker instance per useMoldGenerator hook. The Manifold
 * WASM module loads lazily on the first `generate` message and persists
 * for subsequent generations — we pay the WASM init cost once.
 */

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  if (req.type !== 'generate') {
    // Unknown message — reply with a structured error so the main thread
    // doesn't silently stall waiting on a response.
    const res: WorkerResponse = {
      type: 'error',
      id: (req as { id?: number }).id ?? -1,
      message: `Unknown worker message type: ${(req as { type: string }).type}`,
    };
    ctx.postMessage(res);
    return;
  }

  try {
    // Rehydrate the BufferGeometry from flat typed arrays.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(req.payload.positions, 3),
    );
    if (req.payload.index) {
      geo.setIndex(new THREE.BufferAttribute(req.payload.index, 1));
    }

    const bbox = new THREE.Box3(
      new THREE.Vector3(...req.payload.bboxMin),
      new THREE.Vector3(...req.payload.bboxMax),
    );

    const { top, bottom } = await generateMold(
      geo,
      bbox,
      req.payload.axis,
      req.payload.offset,
      {
        wallThicknessRatio: req.payload.wallThicknessRatio,
        clearanceRatio: req.payload.clearanceRatio,
        moldBoxShape: req.payload.moldBoxShape,
      },
    );

    const res: WorkerResponse = {
      type: 'result',
      id: req.id,
      payload: {
        top: serializeGeometry(top),
        bottom: serializeGeometry(bottom),
      },
    };

    ctx.postMessage(res, collectResultTransferables(res));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const res: WorkerResponse = {
      type: 'error',
      id: req.id,
      message,
    };
    ctx.postMessage(res);
  }
};

export {};
