import { describe, it, expect } from 'vitest';
import {
  getPlaneNormal,
  getPlaneEquation,
  signedDistance,
  clampCutAngle,
  hingeAxisFor,
  primaryAxisValueOnPlane,
  MAX_CUT_ANGLE_DEGREES,
  type Vec3,
} from './planeGeometry';

// Helpers ────────────────────────────────────────────────────────────────────

function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ─────────────────────────────────────────────────────────────────────────────
// hingeAxisFor
// ─────────────────────────────────────────────────────────────────────────────

describe('hingeAxisFor', () => {
  it('uses a right-handed cyclic permutation', () => {
    expect(hingeAxisFor('x')).toBe('y');
    expect(hingeAxisFor('y')).toBe('z');
    expect(hingeAxisFor('z')).toBe('x');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPlaneNormal — axis-aligned fast path
// ─────────────────────────────────────────────────────────────────────────────

describe('getPlaneNormal at tiltAngle=0', () => {
  it('returns exact axis unit vectors (bitwise, not approximate)', () => {
    // These MUST be strict equality — the fast path is load-bearing for
    // backwards compat. Any floating-point drift here regresses existing
    // mold exports at cutAngle=0.
    expect(getPlaneNormal('x', 0)).toEqual([1, 0, 0]);
    expect(getPlaneNormal('y', 0)).toEqual([0, 1, 0]);
    expect(getPlaneNormal('z', 0)).toEqual([0, 0, 1]);
  });

  it('treats omitted tiltAngle as 0', () => {
    expect(getPlaneNormal('z')).toEqual([0, 0, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPlaneNormal — tilted
// ─────────────────────────────────────────────────────────────────────────────

describe('getPlaneNormal at tilted angles', () => {
  it('always returns a unit vector (length = 1 ± 1e-9)', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const angle of [-30, -15, -5, 0, 5, 15, 30]) {
        const n = getPlaneNormal(axis, angle);
        expect(length(n)).toBeCloseTo(1, 9);
      }
    }
  });

  it('rotation is perpendicular to the hinge axis (hinge component is 0)', () => {
    // Tilting a Z-split hinges around X → normal.x should stay 0 for any angle
    for (const angle of [5, 15, 30]) {
      expect(getPlaneNormal('z', angle)[0]).toBe(0);
    }
    // Tilting X hinges around Y → normal.y stays 0
    for (const angle of [5, 15, 30]) {
      expect(getPlaneNormal('x', angle)[1]).toBe(0);
    }
    // Tilting Y hinges around Z → normal.z stays 0
    for (const angle of [5, 15, 30]) {
      expect(getPlaneNormal('y', angle)[2]).toBe(0);
    }
  });

  it('rotation direction is consistent: positive angle tilts toward predictable axis', () => {
    // For Z-split, positive tilt rotates [0,0,1] around +X.
    // Right-hand rule: thumb along +X, fingers curl from +Y → +Z → -Y → -Z.
    // So [0,0,1] at small positive angle should have a small NEGATIVE y component.
    const n = getPlaneNormal('z', 30);
    expect(n[1]).toBeLessThan(0);
    expect(n[2]).toBeGreaterThan(0);
  });

  it('30° tilt produces expected components for Z-axis', () => {
    const n = getPlaneNormal('z', 30);
    expect(n[0]).toBeCloseTo(0, 10);
    expect(n[1]).toBeCloseTo(-0.5, 6); // -sin(30°)
    expect(n[2]).toBeCloseTo(Math.sqrt(3) / 2, 6); // cos(30°)
  });

  // Convention lock-in for ALL three axes. The cyclic convention says
  // "positive tilt rotates the plane normal clockwise when viewed from the
  // hinge axis's positive end". If a future refactor normalises rotations
  // to the standard CG right-hand convention (counter-clockwise positive),
  // these tests will fail loud rather than silently flipping tilt direction
  // in the UI — see hingeAxisFor comment in planeGeometry.ts.
  it('30° tilt produces expected components for X-axis (hinge=Y)', () => {
    const n = getPlaneNormal('x', 30);
    expect(n[0]).toBeCloseTo(Math.sqrt(3) / 2, 6); // cos(30°)
    expect(n[1]).toBeCloseTo(0, 10);
    expect(n[2]).toBeCloseTo(-0.5, 6);             // -sin(30°)
  });

  it('30° tilt produces expected components for Y-axis (hinge=Z)', () => {
    const n = getPlaneNormal('y', 30);
    expect(n[0]).toBeCloseTo(0.5, 6);              // +sin(30°)
    expect(n[1]).toBeCloseTo(Math.sqrt(3) / 2, 6); // cos(30°)
    expect(n[2]).toBeCloseTo(0, 10);
  });

  it('is symmetric under sign flip (negating the angle flips the in-plane component)', () => {
    const plus = getPlaneNormal('z', 20);
    const minus = getPlaneNormal('z', -20);
    expect(plus[0]).toBeCloseTo(minus[0], 10);
    expect(plus[1]).toBeCloseTo(-minus[1], 10);
    expect(plus[2]).toBeCloseTo(minus[2], 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPlaneEquation
// ─────────────────────────────────────────────────────────────────────────────

describe('getPlaneEquation', () => {
  it('axis-aligned case matches old splitPos math exactly', () => {
    const bboxMin: Vec3 = [0, 0, 0];
    const bboxMax: Vec3 = [10, 20, 30];

    // Old: splitPos = bboxMin.z + (bboxMax.z - bboxMin.z) * 0.4 = 12
    // New: originOffset = dot(pivot, [0,0,1]) = pivot.z = 12
    const plane = getPlaneEquation(bboxMin, bboxMax, 'z', 0.4, 0);

    expect(plane.normal).toEqual([0, 0, 1]);
    expect(plane.originOffset).toBe(12);
  });

  it('the pivot point lies exactly on the plane at any tilt angle', () => {
    const bboxMin: Vec3 = [-5, -10, -15];
    const bboxMax: Vec3 = [5, 10, 15];

    // Pivot is the bbox centre with the along-axis component replaced by
    // the sliced position. For axis='z', offset=0.7, pivot = (0, 0, -15 + 30*0.7) = (0, 0, 6)
    const pivot: Vec3 = [0, 0, 6];

    for (const angle of [0, 10, 25, -30]) {
      const plane = getPlaneEquation(bboxMin, bboxMax, 'z', 0.7, angle);
      // Point is on plane iff signedDistance == 0
      expect(signedDistance(pivot, plane)).toBeCloseTo(0, 9);
    }
  });

  it('splits a centred bbox 50/50 at offset=0.5 and any tilt (by symmetry)', () => {
    const bboxMin: Vec3 = [-10, -10, -10];
    const bboxMax: Vec3 = [10, 10, 10];

    for (const angle of [0, 15, 30]) {
      const plane = getPlaneEquation(bboxMin, bboxMax, 'z', 0.5, angle);
      // With the bbox centred on origin and offset=0.5, the pivot is at origin,
      // so originOffset is 0. Origin is on the plane.
      expect(plane.originOffset).toBeCloseTo(0, 9);
      // The +X corner and -X corner should be on opposite sides.
      const dPlus = signedDistance([10, 0, 0], plane);
      const dMinus = signedDistance([-10, 0, 0], plane);
      expect(Math.sign(dPlus) * Math.sign(dMinus)).toBeLessThanOrEqual(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signedDistance
// ─────────────────────────────────────────────────────────────────────────────

describe('signedDistance', () => {
  it('is zero on the plane and signed off it', () => {
    const plane = { normal: [0, 0, 1] as Vec3, originOffset: 5 };
    expect(signedDistance([7, -3, 5], plane)).toBeCloseTo(0, 10);
    expect(signedDistance([7, -3, 8], plane)).toBeCloseTo(3, 10);
    expect(signedDistance([7, -3, 2], plane)).toBeCloseTo(-3, 10);
  });

  it('matches the old axis-component check at tiltAngle=0', () => {
    // Old: pos.z >= splitPos ? above : below
    // New: signedDistance(pos, plane) >= 0 ? above : below
    const bboxMin: Vec3 = [0, 0, 0];
    const bboxMax: Vec3 = [10, 10, 10];
    const splitPos = 4; // offset=0.4
    const plane = getPlaneEquation(bboxMin, bboxMax, 'z', 0.4, 0);

    const points: Vec3[] = [
      [5, 5, 3],   // below
      [5, 5, 5],   // above
      [5, 5, 4],   // exactly on plane → both "inclusive" checks yield true
      [0, 0, 10],
      [10, 10, 0],
    ];
    for (const p of points) {
      const oldSide = p[2] >= splitPos;
      const newSide = signedDistance(p, plane) >= 0;
      expect(newSide).toBe(oldSide);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clampCutAngle
// ─────────────────────────────────────────────────────────────────────────────

describe('clampCutAngle', () => {
  it('is identity inside the range', () => {
    for (const v of [-30, -15, 0, 10, 30]) {
      expect(clampCutAngle(v)).toBe(v);
    }
  });

  it('clamps out-of-range values to the edge', () => {
    expect(clampCutAngle(45)).toBe(MAX_CUT_ANGLE_DEGREES);
    expect(clampCutAngle(-90)).toBe(-MAX_CUT_ANGLE_DEGREES);
  });

  it('coerces non-finite inputs to 0', () => {
    expect(clampCutAngle(NaN)).toBe(0);
    expect(clampCutAngle(Infinity)).toBe(0);
    expect(clampCutAngle(-Infinity)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sanity: the whole pipeline, end-to-end, matches hand-calculated values
// ─────────────────────────────────────────────────────────────────────────────

describe('end-to-end integration', () => {
  it('15° z-tilt on unit cube at origin: normal, offset, and split check line up', () => {
    const bboxMin: Vec3 = [-0.5, -0.5, -0.5];
    const bboxMax: Vec3 = [0.5, 0.5, 0.5];

    const plane = getPlaneEquation(bboxMin, bboxMax, 'z', 0.5, 15);

    // offset=0.5, bbox centred → pivot at origin → originOffset=0
    expect(plane.originOffset).toBeCloseTo(0, 9);

    // normal is unit vector with X=0
    expect(length(plane.normal)).toBeCloseTo(1, 9);
    expect(plane.normal[0]).toBe(0);

    // Top corner (0,0,+0.5) should be on the positive side
    expect(signedDistance([0, 0, 0.5], plane)).toBeGreaterThan(0);
    // Bottom corner (0,0,-0.5) should be on the negative side
    expect(signedDistance([0, 0, -0.5], plane)).toBeLessThan(0);
    // A point at (0, +0.5, 0) — pushed in the -normal.y direction — should be on the negative side
    // because normal.y is negative for positive tilt (right-hand rule)
    expect(signedDistance([0, 0.5, 0], plane)).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// primaryAxisValueOnPlane
// ─────────────────────────────────────────────────────────────────────────────

describe('primaryAxisValueOnPlane', () => {
  it('returns splitPos verbatim for axis-aligned planes (any lateral coords)', () => {
    const plane = getPlaneEquation([-1, -1, -1], [1, 1, 1], 'z', 0.5, 0);
    // axis-aligned, offset=0.5, centered bbox → plane at z=0
    expect(primaryAxisValueOnPlane(plane, 'z', [10, -20, 999])).toBeCloseTo(0, 9);
    expect(primaryAxisValueOnPlane(plane, 'z', [0, 0, 0])).toBeCloseTo(0, 9);
  });

  it('tilts the returned coord linearly with the hinge-axis coord (Z-split, X hinge)', () => {
    // Z-split tilted 15° around X: normal ≈ [0, -sin(15°), cos(15°)]
    // Plane equation: -sin(15°)*y + cos(15°)*z = 0 (pivot at origin)
    // For y=0: any X moves us along the hinge — z should stay 0
    // For y=+1: z = sin(15°)/cos(15°) = tan(15°)
    const plane = getPlaneEquation([-1, -1, -1], [1, 1, 1], 'z', 0.5, 15);
    expect(primaryAxisValueOnPlane(plane, 'z', [0.4, 0, 0])).toBeCloseTo(0, 9);
    expect(primaryAxisValueOnPlane(plane, 'z', [0, 1, 0])).toBeCloseTo(Math.tan(15 * Math.PI / 180), 9);
    expect(primaryAxisValueOnPlane(plane, 'z', [0, -1, 0])).toBeCloseTo(-Math.tan(15 * Math.PI / 180), 9);
  });

  it('round-trips with signedDistance: the returned point has signedDistance=0', () => {
    const plane = getPlaneEquation([-2, -3, -4], [2, 3, 4], 'y', 0.7, 20);
    const query: Vec3 = [1.2, 0, -1.8]; // Y (primary) will be computed
    const primary = primaryAxisValueOnPlane(plane, 'y', query);
    const onPlane: Vec3 = [query[0], primary, query[2]];
    expect(signedDistance(onPlane, plane)).toBeCloseTo(0, 9);
  });

  it('works for all three axes', () => {
    const plane = getPlaneEquation([-1, -1, -1], [1, 1, 1], 'x', 0.3, 10);
    const xCoord = primaryAxisValueOnPlane(plane, 'x', [0, 0.5, -0.5]);
    expect(signedDistance([xCoord, 0.5, -0.5], plane)).toBeCloseTo(0, 9);
  });

  it('returns 0 as a safe fallback when the plane is near-perpendicular to the primary axis', () => {
    // Construct a degenerate plane by hand: primary component is
    // numerically zero, so there's no single-point answer. This branch is
    // unreachable within the ±30° tilt cap (cos(30°) ≈ 0.866) but the
    // fallback exists for future cap widening.
    const degenerate = { normal: [1, 0, 0] as Vec3, originOffset: 42 };
    // Ask for the Z value (primary axis Z) — plane has no Z component so
    // there's no solution; the guard should kick in and return 0 rather
    // than NaN (which would propagate into sprue/vent coords silently).
    expect(primaryAxisValueOnPlane(degenerate, 'z', [0, 0, 0])).toBe(0);
    expect(primaryAxisValueOnPlane(degenerate, 'y', [0, 0, 0])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Defensive clamp: getPlaneEquation should never produce a NaN plane even if
// the caller forgot to clampCutAngle first.
// ─────────────────────────────────────────────────────────────────────────────

describe('getPlaneEquation — defensive clamp', () => {
  const bboxMin: Vec3 = [-1, -1, -1];
  const bboxMax: Vec3 = [1, 1, 1];

  it('does not let NaN tilt poison the plane normal', () => {
    const plane = getPlaneEquation(bboxMin, bboxMax, 'z', 0.5, NaN);
    // NaN → 0 via the internal clampCutAngle. Expect axis-aligned output.
    expect(plane.normal).toEqual([0, 0, 1]);
    expect(Number.isFinite(plane.originOffset)).toBe(true);
  });

  it('does not let Infinity tilt poison the plane normal', () => {
    const plane = getPlaneEquation(bboxMin, bboxMax, 'z', 0.5, Infinity);
    expect(plane.normal).toEqual([0, 0, 1]);
    expect(Number.isFinite(plane.originOffset)).toBe(true);
  });

  it('clamps out-of-range tilt to the cap rather than producing a wildly-tilted plane', () => {
    const plane = getPlaneEquation(bboxMin, bboxMax, 'z', 0.5, 90);
    // 90 is clamped to MAX_CUT_ANGLE_DEGREES; the result should match the
    // MAX_CUT_ANGLE_DEGREES tilt exactly.
    const expected = getPlaneNormal('z', MAX_CUT_ANGLE_DEGREES);
    expect(plane.normal[0]).toBeCloseTo(expected[0], 10);
    expect(plane.normal[1]).toBeCloseTo(expected[1], 10);
    expect(plane.normal[2]).toBeCloseTo(expected[2], 10);
  });
});
