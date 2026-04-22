// Wire-schema regression tests for the STEP-export worker protocol.
//
// This file is the narrow "if the protocol drifts, TS or a test goes red"
// shield. It intentionally does NOT run the worker — the worker itself is
// tested end-to-end in stepExporter.test.ts (which exercises the exact same
// exportSTEP call the worker dispatches to). The point here is to catch a
// structural regression in the request/response shape or the transferables
// helpers BEFORE it ships as a runtime "worker hangs" symptom.

import { describe, it, expect } from 'vitest';
import {
  collectRequestTransferables,
  collectResponseTransferables,
  type StepExportRequest,
  type StepExportResponse,
} from './stepExportProtocol';

describe('stepExportProtocol — wire schema', () => {
  it('accepts a minimal StepExportRequest (typecheck-level)', () => {
    // If positions or the payload wrapper is renamed, this stops compiling.
    const req: StepExportRequest = {
      type: 'export',
      id: 1,
      payload: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      },
    };
    expect(req.payload.positions.length).toBe(9);
  });

  it('accepts optional tolerance and maxTriangles', () => {
    const req: StepExportRequest = {
      type: 'export',
      id: 2,
      payload: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        tolerance: 1e-3,
        maxTriangles: 50_000,
      },
    };
    expect(req.payload.tolerance).toBe(1e-3);
    expect(req.payload.maxTriangles).toBe(50_000);
  });

  it('result response surfaces an ArrayBuffer', () => {
    const res: StepExportResponse = {
      type: 'result',
      id: 1,
      stepBuffer: new ArrayBuffer(16),
    };
    expect(res.type).toBe('result');
    if (res.type === 'result') {
      expect(res.stepBuffer.byteLength).toBe(16);
    }
  });

  it('error response carries a user-surfaceable message', () => {
    const res: StepExportResponse = {
      type: 'error',
      id: 1,
      message: 'mesh has no triangles',
    };
    expect(res.message).toMatch(/triangles/);
  });
});

describe('stepExportProtocol — transferables', () => {
  it('collectRequestTransferables returns the positions buffer exactly once', () => {
    const req: StepExportRequest = {
      type: 'export',
      id: 1,
      payload: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
    };
    const transfers = collectRequestTransferables(req);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toBe(req.payload.positions.buffer);
  });

  it('collectResponseTransferables returns the stepBuffer for results', () => {
    const buf = new ArrayBuffer(32);
    const res: StepExportResponse = { type: 'result', id: 1, stepBuffer: buf };
    const transfers = collectResponseTransferables(res);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toBe(buf);
  });

  it('collectResponseTransferables returns empty for errors', () => {
    const res: StepExportResponse = { type: 'error', id: 1, message: 'nope' };
    expect(collectResponseTransferables(res)).toEqual([]);
  });
});
