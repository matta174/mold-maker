import * as THREE from 'three';
import type { MoldBoxShape } from '../types';

/**
 * Message protocol between the main thread and the mold-generation worker.
 *
 * BufferGeometry can't cross the postMessage boundary intact — its prototype
 * chain, internal Three.js state, and per-attribute class identity are all
 * lost. So we serialize to flat typed arrays (whose underlying ArrayBuffers
 * are transferable — zero-copy transfer), then reconstruct on the other side.
 */

export type WorkerRequest = {
  type: 'generate';
  /** Client-supplied correlation id, echoed back on the response. */
  id: number;
  payload: {
    /** Flat [x,y,z, x,y,z, ...] position buffer. */
    positions: Float32Array;
    /** Optional face indices; if absent, geometry is treated as non-indexed. */
    index?: Uint32Array;
    /** Bounding box min (x,y,z). */
    bboxMin: [number, number, number];
    /** Bounding box max (x,y,z). */
    bboxMax: [number, number, number];
    /** Split axis. */
    axis: 'x' | 'y' | 'z';
    /** Normalized split offset along that axis, 0..1. */
    offset: number;
    /**
     * Tilt of the parting plane around its hinge axis, in degrees.
     * 0 = axis-aligned (the only value produced before oblique-planes shipped).
     * Range: [-30, 30]. Clamped inside generateMold.
     * Omitted → 0 (legacy behaviour).
     */
    cutAngle?: number;
    /**
     * Optional tunable overrides. Omitted fields fall back to the
     * defaults in `../mold/constants`. Kept optional so older callers
     * (and the test suite) don't break when the protocol gains fields.
     */
    wallThicknessRatio?: number;
    clearanceRatio?: number;
    /** Outer shell shape. Omitted → 'rect' (legacy behaviour). */
    moldBoxShape?: MoldBoxShape;
    /**
     * User-specified lateral sprue position in the part's coordinate system.
     * `a` and `b` are lateral coords in the axis frame: for axis='z',
     * (a, b) = (x, y); for axis='y', (a, b) = (z, x); for axis='x',
     * (a, b) = (y, z). Omitted → automatic placement via surface centroid.
     *
     * When present, cavity verification is bypassed — the mold generator
     * respects the user's choice even if it falls in empty space. The UI
     * is responsible for warning the user in that case.
     */
    sprueOverride?: { a: number; b: number };
  };
};

export type WorkerResponse =
  | {
      type: 'result';
      id: number;
      payload: {
        top: SerializedGeometry;
        bottom: SerializedGeometry;
      };
    }
  | {
      type: 'error';
      id: number;
      /** User-surfaceable error message. */
      message: string;
    };

export interface SerializedGeometry {
  positions: Float32Array;
  normals?: Float32Array;
  index?: Uint32Array;
}

/**
 * Extract the transferable ArrayBuffers out of a WorkerRequest so the
 * caller can pass them as the `transfer` arg to postMessage.
 *
 * Return type is `ArrayBufferLike[]` (= `ArrayBuffer | SharedArrayBuffer`)
 * because TypedArray.buffer resolves to that union in TS 5+. Both sides
 * of the union satisfy the Transferable protocol, so postMessage accepts
 * the array directly.
 *
 * After transfer the buffer on the sending side is detached — do not
 * touch it again.
 */
export function collectTransferables(req: WorkerRequest): ArrayBufferLike[] {
  const transfers: ArrayBufferLike[] = [req.payload.positions.buffer];
  if (req.payload.index) transfers.push(req.payload.index.buffer);
  return transfers;
}

export function collectResultTransferables(res: WorkerResponse): ArrayBufferLike[] {
  if (res.type !== 'result') return [];
  const { top, bottom } = res.payload;
  const transfers: ArrayBufferLike[] = [top.positions.buffer, bottom.positions.buffer];
  if (top.normals) transfers.push(top.normals.buffer);
  if (bottom.normals) transfers.push(bottom.normals.buffer);
  if (top.index) transfers.push(top.index.buffer);
  if (bottom.index) transfers.push(bottom.index.buffer);
  return transfers;
}

/**
 * Serialize a BufferGeometry to plain typed arrays. We intentionally do not
 * preserve uv/color attributes — the mold halves don't need them and the
 * smaller payload keeps transfers fast.
 */
export function serializeGeometry(geo: THREE.BufferGeometry): SerializedGeometry {
  const positionAttr = geo.attributes.position;
  if (!positionAttr) {
    throw new Error('Geometry has no position attribute — cannot serialize.');
  }

  // Clone into a fresh Float32Array so we own the buffer and can transfer it.
  const positions = new Float32Array(positionAttr.array as Float32Array);

  const out: SerializedGeometry = { positions };

  const normalAttr = geo.attributes.normal;
  if (normalAttr) {
    out.normals = new Float32Array(normalAttr.array as Float32Array);
  }

  if (geo.index) {
    // Normalize index to Uint32Array so the receiver doesn't need to
    // branch on Uint16 vs Uint32.
    out.index = new Uint32Array(geo.index.array as Uint16Array | Uint32Array);
  }

  return out;
}

/**
 * Reconstruct a BufferGeometry from a serialized payload. The typed arrays
 * passed in are assumed to be owned by the caller after transfer.
 */
export function deserializeGeometry(s: SerializedGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
  if (s.normals) {
    geo.setAttribute('normal', new THREE.BufferAttribute(s.normals, 3));
  }
  if (s.index) {
    geo.setIndex(new THREE.BufferAttribute(s.index, 1));
  }
  return geo;
}
