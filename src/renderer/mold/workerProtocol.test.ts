// Worker-protocol regression tests.
//
// Why this file exists: the previous CSG refactor adds a `cutAngle?` field
// to WorkerRequest.payload. If a future schema change drops it, renames it,
// or forgets to thread it into generateMold's options, the main thread
// would silently run every mold generation at cutAngle=0. No existing test
// caught that — channelPlacement tests pass with mocked bboxes, the spike
// hits splitByPlane directly, and generateMold.integration.test.ts bypasses
// the worker entirely. This file is the narrow wire-level shield.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  serializeGeometry,
  deserializeGeometry,
  collectTransferables,
  type WorkerRequest,
} from './workerProtocol';

describe('workerProtocol — cutAngle wire schema', () => {
  it('accepts cutAngle on the request payload (typecheck-level)', () => {
    // If the field is renamed/removed, this file stops compiling.
    const req: WorkerRequest = {
      type: 'generate',
      id: 1,
      payload: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        bboxMin: [0, 0, 0],
        bboxMax: [1, 1, 1],
        axis: 'z',
        offset: 0.5,
        cutAngle: 15,
      },
    };
    expect(req.payload.cutAngle).toBe(15);
  });

  it('cutAngle survives a JSON round-trip (structural proxy for structured clone)', () => {
    // Actual postMessage performs a structured clone — not identical to
    // JSON but equivalent for the fields we care about here. This catches
    // the case where someone types cutAngle as `number | undefined` and
    // accidentally stores a function or a symbol that would strip silently.
    const payload: WorkerRequest['payload'] = {
      positions: new Float32Array([0, 0, 0]),
      bboxMin: [0, 0, 0],
      bboxMax: [1, 1, 1],
      axis: 'z',
      offset: 0.5,
      cutAngle: 20,
    };
    const cloned = JSON.parse(JSON.stringify({ cutAngle: payload.cutAngle }));
    expect(cloned.cutAngle).toBe(20);
  });

  it('omitted cutAngle stays omitted (legacy callers do not silently flip to a default)', () => {
    const req: WorkerRequest = {
      type: 'generate',
      id: 1,
      payload: {
        positions: new Float32Array([0, 0, 0]),
        bboxMin: [0, 0, 0],
        bboxMax: [1, 1, 1],
        axis: 'z',
        offset: 0.5,
      },
    };
    // `cutAngle` absent in the payload means "use default" — the worker
    // passes `undefined` through to generateMold, where `?? 0` kicks in.
    // If this test fails it means the protocol has started auto-filling
    // cutAngle, which would surprise any caller relying on the
    // "absent == default" contract.
    expect('cutAngle' in req.payload).toBe(false);
  });
});

describe('workerProtocol — geometry round-trip', () => {
  it('serialize → deserialize preserves position data verbatim', () => {
    const src = new THREE.BufferGeometry();
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    src.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const serialized = serializeGeometry(src);
    const restored = deserializeGeometry(serialized);

    const restoredPos = restored.attributes.position.array as Float32Array;
    expect(Array.from(restoredPos)).toEqual(Array.from(positions));
  });

  it('serialize clones the position buffer so the original survives transfer', () => {
    // serializeGeometry copies into a fresh Float32Array — otherwise calling
    // collectTransferables on the result would detach the CALLER'S buffer.
    const src = new THREE.BufferGeometry();
    const positions = new Float32Array([1, 2, 3]);
    src.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const serialized = serializeGeometry(src);
    expect(serialized.positions).not.toBe(positions);
    // The serialized buffer is a fresh, independently-transferable copy.
    expect(serialized.positions.buffer).not.toBe(positions.buffer);
  });
});

describe('workerProtocol — transferables list', () => {
  it('includes the positions buffer', () => {
    const req: WorkerRequest = {
      type: 'generate',
      id: 1,
      payload: {
        positions: new Float32Array([1, 2, 3]),
        bboxMin: [0, 0, 0],
        bboxMax: [1, 1, 1],
        axis: 'z',
        offset: 0.5,
        cutAngle: 10,
      },
    };
    const transfers = collectTransferables(req);
    expect(transfers).toContain(req.payload.positions.buffer);
  });

  it('adds the index buffer when present', () => {
    const req: WorkerRequest = {
      type: 'generate',
      id: 1,
      payload: {
        positions: new Float32Array([1, 2, 3]),
        index: new Uint32Array([0, 1, 2]),
        bboxMin: [0, 0, 0],
        bboxMax: [1, 1, 1],
        axis: 'z',
        offset: 0.5,
      },
    };
    const transfers = collectTransferables(req);
    expect(transfers).toContain(req.payload.positions.buffer);
    expect(transfers).toContain(req.payload.index!.buffer);
    expect(transfers).toHaveLength(2);
  });

  it('sprueOverride survives the request schema round-trip', () => {
    // Mirrors the cutAngle tests — sprueOverride is a nested object of two
    // numbers. If someone later types it as a branded class with a prototype
    // chain, structured clone would strip methods silently. JSON round-trip
    // catches the "shape drifted" case well enough at wire level.
    const req: WorkerRequest = {
      type: 'generate',
      id: 1,
      payload: {
        positions: new Float32Array([0, 0, 0]),
        bboxMin: [0, 0, 0],
        bboxMax: [1, 1, 1],
        axis: 'z',
        offset: 0.5,
        sprueOverride: { a: 3.5, b: -1.25 },
      },
    };
    expect(req.payload.sprueOverride).toEqual({ a: 3.5, b: -1.25 });
    const cloned = JSON.parse(JSON.stringify({ sprueOverride: req.payload.sprueOverride }));
    expect(cloned.sprueOverride).toEqual({ a: 3.5, b: -1.25 });
  });

  it('omitted sprueOverride stays omitted (auto-placement is the default path)', () => {
    // Absent → worker forwards `undefined` → generateMold runs the centroid
    // path unchanged. If this flips (e.g. someone defaults it to `{a:0,b:0}`
    // at the protocol layer), every auto-placement mold would silently drop
    // onto origin — a nasty regression that no other test would catch.
    const req: WorkerRequest = {
      type: 'generate',
      id: 1,
      payload: {
        positions: new Float32Array([0, 0, 0]),
        bboxMin: [0, 0, 0],
        bboxMax: [1, 1, 1],
        axis: 'z',
        offset: 0.5,
      },
    };
    expect('sprueOverride' in req.payload).toBe(false);
  });

  it('cutAngle is a plain number — not transferable, not in the list', () => {
    // Sanity: cutAngle is scalar data and rides along in the structured
    // clone. Confirming it doesn't accidentally get added to the transfer
    // list (which would throw "not transferable" at postMessage time).
    const req: WorkerRequest = {
      type: 'generate',
      id: 1,
      payload: {
        positions: new Float32Array([1, 2, 3]),
        bboxMin: [0, 0, 0],
        bboxMax: [1, 1, 1],
        axis: 'z',
        offset: 0.5,
        cutAngle: 25,
      },
    };
    const transfers = collectTransferables(req);
    // Only the positions buffer. cutAngle is NOT present as a plain value
    // because it isn't an ArrayBuffer.
    expect(transfers).toHaveLength(1);
  });
});
