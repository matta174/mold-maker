/// <reference lib="webworker" />
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated worker for STEP export.
// ─────────────────────────────────────────────────────────────────────────────
//
// Why its own worker (not a message on the Manifold worker): exportSTEP pulls
// in 66 MB of OpenCascade WASM and takes ~2-3 ms per triangle (20-30 s for a
// typical mold). Running it in the Manifold worker would (a) mix two unrelated
// WASM modules in one context and (b) block subsequent generateMold calls if
// the user tweaks parameters mid-export. See docs/adr/0001-step-export-library.md
// for the architectural rationale.
//
// Lifetime: one worker per useMoldGenerator hook, constructed lazily on first
// STEP export. The OCP module persists between exports so the 66 MB WASM init
// is paid once. Terminated on unmount OR on user-initiated cancel.

import * as THREE from 'three';
import { exportSTEP } from './stepExporter';
import {
  collectResponseTransferables,
  type StepExportRequest,
  type StepExportResponse,
} from './stepExportProtocol';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

// Track the in-flight request's id so the global error/unhandledrejection
// handlers below can address their response to the right awaiter. There's
// only ever one in-flight export at a time (the main thread serializes
// requests), so a single variable is enough — no queue needed.
//
// Why this exists: emscripten's abort path (e.g. out-of-memory, WASM trap)
// does NOT always throw synchronously into our onmessage try/catch. It can
// surface as an unhandledrejection at the worker global, or fire the worker's
// `onerror`. Without these catches the main thread would see the worker go
// silent and only notice on unmount — users would stare at a "Exporting
// STEP…" button forever. Catching at the global scope and posting back a
// structured error response keeps the promise chain alive.
let currentRequestId: number | null = null;

function sendError(id: number | null, message: string): void {
  const res: StepExportResponse = {
    type: 'error',
    id: id ?? -1,
    message,
  };
  ctx.postMessage(res);
}

ctx.onmessage = async (ev: MessageEvent<StepExportRequest>) => {
  const req = ev.data;
  if (req.type !== 'export') {
    sendError(
      (req as { id?: number }).id ?? -1,
      `Unknown step-export worker message type: ${(req as { type: string }).type}`,
    );
    return;
  }

  currentRequestId = req.id;
  try {
    // Rehydrate just enough BufferGeometry for exportSTEP. No normals, no
    // index — STEP export doesn't use them (it sews from raw triangles).
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(req.payload.positions, 3),
    );

    const stepBuffer = await exportSTEP(geo, {
      tolerance: req.payload.tolerance,
      maxTriangles: req.payload.maxTriangles,
    });

    const res: StepExportResponse = {
      type: 'result',
      id: req.id,
      stepBuffer,
    };

    ctx.postMessage(res, collectResponseTransferables(res));
  } catch (err) {
    sendError(req.id, err instanceof Error ? err.message : String(err));
  } finally {
    currentRequestId = null;
  }
};

// Last-resort handlers for errors that escape the try/catch above. OCP can
// abort via emscripten's runtime, which may surface here rather than as a
// thrown exception at the await point.
ctx.addEventListener('error', (ev: ErrorEvent) => {
  // preventDefault so the browser doesn't also log a "Uncaught" from this
  // path — the main thread's onmessage handler will receive the structured
  // response and surface it through translateStepError.
  ev.preventDefault?.();
  sendError(
    currentRequestId,
    ev.message || 'STEP export engine crashed (unhandled worker error)',
  );
});

ctx.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
  ev.preventDefault?.();
  const reason = ev.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'STEP export engine crashed (unhandled rejection)';
  sendError(currentRequestId, message);
});

export {};
