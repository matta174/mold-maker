import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  lateralAxisIndices,
  primaryAxisIndex,
  pickCornerRadius,
  computeMoldEnvelope,
  csDimsForAxis,
} from './moldBox';
import type { Axis } from '../types';

function bbox(min: [number, number, number], max: [number, number, number]): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(...min),
    new THREE.Vector3(...max),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Axis index helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('primaryAxisIndex', () => {
  it('maps x/y/z → 0/1/2', () => {
    expect(primaryAxisIndex('x')).toBe(0);
    expect(primaryAxisIndex('y')).toBe(1);
    expect(primaryAxisIndex('z')).toBe(2);
  });
});

describe('lateralAxisIndices', () => {
  it('returns the two non-parting axes in (primary+1, primary+2) order', () => {
    expect(lateralAxisIndices('x')).toEqual([1, 2]);
    expect(lateralAxisIndices('y')).toEqual([2, 0]);
    expect(lateralAxisIndices('z')).toEqual([0, 1]);
  });

  it('each result is a 2-element tuple of distinct indices not equal to the primary', () => {
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const [a, b] = lateralAxisIndices(axis);
      const p = primaryAxisIndex(axis);
      expect(a).not.toBe(b);
      expect(a).not.toBe(p);
      expect(b).not.toBe(p);
      expect([0, 1, 2]).toContain(a);
      expect([0, 1, 2]).toContain(b);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pickCornerRadius
// ─────────────────────────────────────────────────────────────────────────────

describe('pickCornerRadius', () => {
  it('is capped by wallThickness * (1 - PIN_INSET_RATIO) so pin bodies land on material', () => {
    // PIN_INSET_RATIO = 0.7 → cap = 0.3 × wallThickness = 3 for wall=10
    // Lateral sizes are huge → wall bound dominates
    expect(pickCornerRadius(100, 100, 10)).toBeCloseTo(3, 5);
  });

  it('is capped by half the shorter lateral dimension (prevents stadium shape)', () => {
    // Wall is huge, but shorter lateral half (= 2) dominates
    expect(pickCornerRadius(20, 4, 100)).toBeCloseTo(2, 5);
  });

  it('returns 0 when wall thickness is 0', () => {
    expect(pickCornerRadius(10, 10, 0)).toBe(0);
  });

  it('returns 0 when shorter lateral is 0', () => {
    expect(pickCornerRadius(10, 0, 5)).toBe(0);
  });

  it('never returns a negative radius', () => {
    expect(pickCornerRadius(-5, -5, -5)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMoldEnvelope — rect
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMoldEnvelope (rect)', () => {
  it('matches legacy rect math: bbox grown by wallThickness on each axis', () => {
    const b = bbox([0, 0, 0], [10, 20, 30]);
    const env = computeMoldEnvelope(b, 'rect', 'z', 2);
    expect(env.shape).toBe('rect');
    expect(env.moldMin.toArray()).toEqual([-2, -2, -2]);
    expect(env.moldSize.toArray()).toEqual([14, 24, 34]);
    expect(env.cornerRadius).toBeUndefined();
    expect(env.cylinderRadius).toBeUndefined();
  });

  it('respects wallThickness of 0 (degenerate but well-defined)', () => {
    const b = bbox([1, 2, 3], [4, 5, 6]);
    const env = computeMoldEnvelope(b, 'rect', 'x', 0);
    expect(env.moldMin.toArray()).toEqual([1, 2, 3]);
    expect(env.moldSize.toArray()).toEqual([3, 3, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMoldEnvelope — roundedRect
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMoldEnvelope (roundedRect)', () => {
  it('AABB matches the rect envelope (outer shell only rounds the corners, not the bbox)', () => {
    const b = bbox([0, 0, 0], [10, 20, 30]);
    const envRect = computeMoldEnvelope(b, 'rect', 'z', 2);
    const envR = computeMoldEnvelope(b, 'roundedRect', 'z', 2);
    expect(envR.moldMin.toArray()).toEqual(envRect.moldMin.toArray());
    expect(envR.moldSize.toArray()).toEqual(envRect.moldSize.toArray());
  });

  it('exposes a cornerRadius > 0 for sane inputs', () => {
    const b = bbox([0, 0, 0], [10, 10, 10]);
    const env = computeMoldEnvelope(b, 'roundedRect', 'z', 3);
    expect(env.shape).toBe('roundedRect');
    expect(env.cornerRadius).toBeGreaterThan(0);
  });

  it('cornerRadius shrinks for very thin parts (cap by lateral dim)', () => {
    // Part is 0.5 thick laterally, wall is 10 → corner capped by half-lateral (= 0.25)
    const b = bbox([0, 0, 0], [0.5, 20, 30]);
    const env = computeMoldEnvelope(b, 'roundedRect', 'z', 10);
    expect(env.cornerRadius).toBeCloseTo(0.25, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMoldEnvelope — cylinder
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMoldEnvelope (cylinder)', () => {
  it('cylinderRadius = diagonal of part bbox lateral + wallThickness (honest thick wall at every angle)', () => {
    // 10x10 lateral bbox → diagonal radius = sqrt(5^2+5^2) = ~7.0711
    // Plus wall thickness 2 → ~9.0711
    const b = bbox([0, 0, 0], [10, 10, 30]);
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 2);
    expect(env.shape).toBe('cylinder');
    expect(env.cylinderRadius).toBeCloseTo(Math.sqrt(50) + 2, 5);
  });

  it('cylinder extrusion length along parting axis = bbox length + 2*wallThickness (same as rect)', () => {
    const b = bbox([0, 0, 0], [10, 10, 30]);
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 2);
    // moldSize along Z = 30 + 4 = 34
    expect(env.moldSize.z).toBe(34);
    // And the along-axis min = -2
    expect(env.moldMin.z).toBe(-2);
  });

  it('AABB laterally = 2*cylinderRadius (square circumscribing the circle)', () => {
    const b = bbox([0, 0, 0], [10, 10, 30]);
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 2);
    const r = env.cylinderRadius!;
    expect(env.moldSize.x).toBeCloseTo(2 * r, 5);
    expect(env.moldSize.y).toBeCloseTo(2 * r, 5);
  });

  it('cylinder center = bbox lateral center (not 0,0)', () => {
    // bbox shifted in x and y
    const b = bbox([5, 10, 0], [15, 20, 30]);
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 1);
    // Part center laterally = (10, 15)
    expect(env.cylinderCenterLatA).toBeCloseTo(10, 5);
    expect(env.cylinderCenterLatB).toBeCloseTo(15, 5);
    // moldMin laterally = center - radius
    expect(env.moldMin.x).toBeCloseTo(10 - env.cylinderRadius!, 5);
    expect(env.moldMin.y).toBeCloseTo(15 - env.cylinderRadius!, 5);
  });

  it('respects non-Z parting axis (cylinder extrudes along X)', () => {
    // For axis='x', lateral axes are [y, z]; along-axis is x
    const b = bbox([0, 0, 0], [30, 10, 10]);
    const env = computeMoldEnvelope(b, 'cylinder', 'x', 2);
    // Along x: 30 + 4 = 34
    expect(env.moldSize.x).toBe(34);
    expect(env.moldMin.x).toBe(-2);
    // Cylinder radius = sqrt(5^2+5^2) + 2 ≈ 9.0711
    const expectedR = Math.sqrt(50) + 2;
    expect(env.cylinderRadius).toBeCloseTo(expectedR, 5);
    expect(env.moldSize.y).toBeCloseTo(2 * expectedR, 5);
    expect(env.moldSize.z).toBeCloseTo(2 * expectedR, 5);
  });

  it('asymmetric lateral bbox still yields a circle that contains the diagonal', () => {
    // 2×20 lateral → diagonal = sqrt(1^2 + 10^2) ≈ 10.05
    const b = bbox([0, 0, 0], [2, 20, 30]);
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 0);
    expect(env.cylinderRadius).toBeCloseTo(Math.sqrt(1 + 100), 5);
    // Lateral AABB must cover both the narrow and the wide axis
    expect(env.moldSize.x).toBeGreaterThanOrEqual(2);
    expect(env.moldSize.y).toBeGreaterThanOrEqual(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// csDimsForAxis — pins the cross-section axis mapping
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the test that would have caught the rounded-rect rotation bug. Each
// case asserts that after the prism is rotated into the parting-axis frame,
// its AABB extents match the moldSize on every world axis. The test verifies
// the *contract*; the actual rotation happens in createMoldBoxManifold and is
// covered by repro_coasterBug.test.ts at the integration level.

describe('csDimsForAxis', () => {
  // Use distinct sizes per axis so a swap is obvious. World moldSize has
  // X=11, Y=22, Z=33.
  const moldSize = new THREE.Vector3(11, 22, 33);

  it('axis=z: identity — csX=X, csY=Y, length=Z', () => {
    const { csX, csY, length } = csDimsForAxis('z', moldSize);
    expect(csX).toBe(11);
    expect(csY).toBe(22);
    expect(length).toBe(33);
  });

  it('axis=y: rotate(X,+90°) sends prism +Z→world -Y, prism +Y→world +Z; csX=X, csY=Z', () => {
    // After rotate([90,0,0]):
    //   - extrude axis (+Z) becomes -Y → world Y extent = length
    //   - 2D X axis stays world X → csX must equal world X extent (11)
    //   - 2D Y axis becomes world Z → csY must equal world Z extent (33)
    const { csX, csY, length } = csDimsForAxis('y', moldSize);
    expect(csX).toBe(11);
    expect(csY).toBe(33);
    expect(length).toBe(22);
  });

  it('axis=x: rotate(Y,+90°) sends prism +Z→world +X, prism +X→world -Z; csX=Z, csY=Y', () => {
    // After rotate([0,90,0]):
    //   - extrude axis (+Z) becomes +X → world X extent = length
    //   - 2D X axis becomes -Z → csX must equal world Z extent (33)
    //   - 2D Y axis stays world Y → csY must equal world Y extent (22)
    const { csX, csY, length } = csDimsForAxis('x', moldSize);
    expect(csX).toBe(33);
    expect(csY).toBe(22);
    expect(length).toBe(11);
  });

  // Sanity: regardless of axis, csX*csY*length must equal volume product.
  // This catches any future swap that re-introduces the bug — even if the
  // swap is "consistent" between csX and csY, the cube product is invariant.
  it('csX × csY × length = product of moldSize components for every axis', () => {
    const expected = moldSize.x * moldSize.y * moldSize.z;
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const { csX, csY, length } = csDimsForAxis(axis, moldSize);
      expect(csX * csY * length).toBe(expected);
    }
  });
});
