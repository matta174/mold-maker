// ─────────────────────────────────────────────────────────────────────────────
// Message protocol between the main thread and the STEP-export worker.
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors workerProtocol.ts (the Manifold worker) in shape, but stays in its
// own file so the two protocols can evolve independently. One worker per WASM
// module is the convention — see docs/adr/0001-step-export-library.md.
//
// Why a separate protocol at all: STEP export has different inputs (raw
// position buffer, not a full BufferGeometry with bbox + axis + etc.) and
// different outputs (a single ArrayBuffer of text bytes, not two geometries).
// Reusing WorkerRequest/Response would force both sides to wear the wrong
// hat.

export type StepExportRequest = {
  type: 'export';
  /** Correlation id so stale responses from superseded requests can be ignored. */
  id: number;
  payload: {
    /** Flat [x,y,z, x,y,z, ...] non-indexed position buffer. */
    positions: Float32Array;
    /** Sewing tolerance in mm. See stepExporter.ts for defaults/guidance. */
    tolerance?: number;
    /** Soft cap on triangle count; exportSTEP rejects above this. */
    maxTriangles?: number;
  };
};

export type StepExportResponse =
  | {
      type: 'result';
      id: number;
      /** The STEP file bytes. Transferable — caller takes ownership. */
      stepBuffer: ArrayBuffer;
    }
  | {
      type: 'error';
      id: number;
      /** User-surfaceable error message. */
      message: string;
    };

/**
 * Transferables for the request. After transfer, the caller's Float32Array is
 * detached — do not touch it again. Clone before posting if the buffer is
 * still needed by the UI (it almost always is — the live preview references it).
 */
export function collectRequestTransferables(
  req: StepExportRequest,
): ArrayBufferLike[] {
  return [req.payload.positions.buffer];
}

/**
 * Transferables for the response. The worker should pass these to postMessage
 * so the 1-30 MB step text doesn't get structured-cloned across the boundary.
 */
export function collectResponseTransferables(
  res: StepExportResponse,
): ArrayBufferLike[] {
  return res.type === 'result' ? [res.stepBuffer] : [];
}
