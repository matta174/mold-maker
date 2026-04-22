import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  getRegistrationPinPositions,
  getRotationForAxis,
  computeChannelPositions,
  computeChannelPositionsForEnvelope,
  clampToMoldInterior,
  fallbackVentSeeds,
} from './channelPlacement';
import { computeMoldEnvelope } from './moldBox';

function bbox(min: [number, number, number], max: [number, number, number]): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(...min),
    new THREE.Vector3(...max),
  );
}

describe('getRegistrationPinPositions', () => {
  it('places exactly 4 pins on Z-axis at split plane', () => {
    const b = bbox([-10, -10, -10], [10, 10, 10]);
    const pins = getRegistrationPinPositions(b, 'z', 0, 1);
    expect(pins).toHaveLength(4);
    // All pins sit exactly on the split plane (z = 0)
    for (const p of pins) expect(p[2]).toBe(0);
  });

  it('Y-axis pins sit on the Y split plane', () => {
    const b = bbox([0, 0, 0], [10, 10, 10]);
    const pins = getRegistrationPinPositions(b, 'y', 5, 2);
    expect(pins).toHaveLength(4);
    for (const p of pins) expect(p[1]).toBe(5);
  });

  it('inset pushes pins OUTSIDE the bbox corners (so pin bodies clear the part)', () => {
    const b = bbox([0, 0, 0], [10, 10, 10]);
    const pins = getRegistrationPinPositions(b, 'z', 5, 10); // wall=10 → inset=7
    // First pin is min.x - inset, min.y - inset → should be negative
    expect(pins[0][0]).toBeLessThan(0);
    expect(pins[0][1]).toBeLessThan(0);
    // Fourth pin is max corner + inset → should exceed max
    expect(pins[3][0]).toBeGreaterThan(10);
    expect(pins[3][1]).toBeGreaterThan(10);
  });
});

describe('getRotationForAxis', () => {
  it('returns rotations in DEGREES (not radians) for manifold-3d', () => {
    // 90° rotations; radians would be ~1.57
    expect(getRotationForAxis('x')).toEqual([0, 90, 0]);
    expect(getRotationForAxis('y')).toEqual([-90, 0, 0]);
    expect(getRotationForAxis('z')).toEqual([0, 0, 0]);
  });

  it('orients cylinders to extend in the +parting-axis direction from origin', () => {
    // Sanity check: the rotation must send the cylinder's natural extrusion
    // direction (+Z) onto the +parting-axis. We verify by applying each
    // rotation to the unit vector (0, 0, 1) using a hand-rolled Euler XYZ
    // matmul (matches three.js / manifold-3d's intrinsic XYZ convention).
    function rotateZUnit(rot: [number, number, number]): [number, number, number] {
      const [rxd, ryd, rzd] = rot;
      const rx = (rxd * Math.PI) / 180;
      const ry = (ryd * Math.PI) / 180;
      const rz = (rzd * Math.PI) / 180;
      // Start with +Z = (0, 0, 1)
      let [x, y, z] = [0, 0, 1];
      // Rx
      [y, z] = [Math.cos(rx) * y - Math.sin(rx) * z, Math.sin(rx) * y + Math.cos(rx) * z];
      // Ry
      [x, z] = [Math.cos(ry) * x + Math.sin(ry) * z, -Math.sin(ry) * x + Math.cos(ry) * z];
      // Rz
      [x, y] = [Math.cos(rz) * x - Math.sin(rz) * y, Math.sin(rz) * x + Math.cos(rz) * y];
      return [x, y, z];
    }
    const round = (v: [number, number, number]): [number, number, number] =>
      v.map((c) => Math.round(c * 1000) / 1000) as [number, number, number];

    expect(round(rotateZUnit(getRotationForAxis('x')))).toEqual([1, 0, 0]);  // +X
    expect(round(rotateZUnit(getRotationForAxis('y')))).toEqual([0, 1, 0]);  // +Y (NOT -Y)
    expect(round(rotateZUnit(getRotationForAxis('z')))).toEqual([0, 0, 1]);  // +Z
  });
});

describe('computeChannelPositions', () => {
  it('places sprue on the split plane and returns at least MIN_VENTS vents', () => {
    // A 10x10x10 box of vertices around origin
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    for (let x = -5; x <= 5; x += 5) {
      for (let y = -5; y <= 5; y += 5) {
        for (let z = -5; z <= 5; z += 5) {
          verts.push(x, y, z);
        }
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    const b = bbox([-5, -5, -5], [5, 5, 5]);
    const moldMin = new THREE.Vector3(-10, -10, -10);
    const moldSize = new THREE.Vector3(20, 20, 20);
    const splitPos = 0;

    const result = computeChannelPositions(b, 'z', splitPos, moldMin, moldSize, geo);

    // Sprue Z matches split plane
    expect(result.spruePos[2]).toBe(splitPos);
    // Sprue height = distance from split to mold top face
    expect(result.sprueHeight).toBe(10);
    // At least MIN_VENTS (=2) vents
    expect(result.ventPositions.length).toBeGreaterThanOrEqual(2);
    // Each vent sits on the split plane
    for (const v of result.ventPositions) {
      expect(v[2]).toBe(splitPos);
    }
    // Rotation in degrees (z-axis → [0,0,0])
    expect(result.rotation).toEqual([0, 0, 0]);
  });

  it('returns Y-axis rotation in DEGREES for Y split', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 1, 0, 1, 1, 0, 0, 1, 1, // all above y=0
    ]), 3));

    const b = bbox([0, 0, 0], [1, 2, 1]);
    const result = computeChannelPositions(
      b, 'y', 1, new THREE.Vector3(-1, -1, -1), new THREE.Vector3(3, 4, 3), geo,
    );
    // -90° (not +90°) — direction matters: +90° flips the cylinder into the
    // bottom mold, making the sprue subtract a no-op (no pour hole). See
    // getRotationForAxis comment.
    expect(result.rotation).toEqual([-90, 0, 0]);
  });
});

describe('oblique parting planes (cutAngle > 0)', () => {
  it('cutAngle=0 produces bit-identical output to the cutAngle-omitted call', () => {
    const b = bbox([-10, -10, -10], [10, 10, 10]);
    const legacy = getRegistrationPinPositions(b, 'z', 0, 1);
    const withZero = getRegistrationPinPositions(b, 'z', 0, 1, 0);
    expect(withZero).toEqual(legacy);
  });

  it('lifts registration pins onto the tilted plane (Z-split, 15°)', () => {
    const b = bbox([-10, -10, -10], [10, 10, 10]);
    const pins = getRegistrationPinPositions(b, 'z', 0, 1, 15);
    expect(pins).toHaveLength(4);
    // At cutAngle=0 all pins sat at z=0. Under a positive tilt around the
    // hinge (x), pins at y > 0 should drop BELOW z=0 (normal has -sin(15°) in
    // y component, so positive-y points are on the negative-normal side of a
    // through-origin plane — to land ON the plane they need z < 0).
    // More practically: we require each pin to be within ~tan(15°)*bbox on
    // either side of z=0 and NOT all at z=0.
    const zCoords = pins.map(p => p[2]);
    expect(zCoords.some(z => z !== 0)).toBe(true);
    // Every pin lies on the plane (signedDistance ≈ 0):
    // dot(pin, normal) - originOffset = 0. For Z/15° normal = (0, -sin15, cos15),
    // pivot at origin → originOffset=0. So: -sin15*y + cos15*z == 0 for each pin.
    const s = Math.sin(15 * Math.PI / 180);
    const c = Math.cos(15 * Math.PI / 180);
    for (const [_x, y, z] of pins) {
      expect(-s * y + c * z).toBeCloseTo(0, 9);
    }
  });

  it('reclassifies top half via signed distance under tilt (Z-split, 15°)', () => {
    // Three equal-area triangles whose CENTROIDS (not individual vertices)
    // demonstrate the classifier swap. The sprue centroid is area-weighted
    // over triangle centroids, so classification is per-triangle-centroid.
    //
    // With Z/15° normal = (0, -sin15, cos15), pivot at origin:
    //   Triangle A, centroid (0,  5,  5): signedDist ≈ +3.54 → TOP both regimes
    //   Triangle B, centroid (0, -5, -0.5): signedDist ≈ +0.811 → TOP only under tilt
    //                                        (axis-aligned z = -0.5 < 0 → BOTTOM)
    //   Triangle C, centroid (0,  5, -5): signedDist ≈ -6.12 → BOTTOM both
    //
    // All three triangles have equal area (48 sq units) AND wide XY extents
    // that contain both the "flat" centroid (0, 5) AND the "tilted" centroid
    // (0, 0). This keeps the sprue-in-cavity verification happy (no snapping)
    // so the test can pin the exact post-classifier centroid.
    const verts = [
      // Triangle A — centroid (0, 5, 5). XY projection covers both (0,5) and (0,0).
      -2, -3, 5,   2, -3, 5,   0, 21, 5,
      // Triangle B — centroid (0, -5, -0.5). XY projection covers (0,0).
      -2, 3, -0.5,   2, 3, -0.5,   0, -21, -0.5,
      // Triangle C — centroid (0, 5, -5). Always bottom half, shape irrelevant.
      -2, -3, -5,   2, -3, -5,   0, 21, -5,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    const b = bbox([-10, -10, -10], [10, 10, 10]);
    const moldMin = new THREE.Vector3(-15, -15, -15);
    const moldSize = new THREE.Vector3(30, 30, 30);

    // cutAngle=0 regime: only triangle A qualifies — centroid y = 5.
    const flat = computeChannelPositions(b, 'z', 0, moldMin, moldSize, geo, 0);
    expect(flat.spruePos[1]).toBeCloseTo(5, 9);

    // 15° regime: triangles A AND B qualify. Equal areas, centroids y=5 and y=-5,
    // area-weighted → y = (5 + -5)/2 = 0. The sprue y changes from 5 to 0,
    // demonstrating the signed-distance classifier swap.
    const tilted = computeChannelPositions(b, 'z', 0, moldMin, moldSize, geo, 15);
    expect(tilted.spruePos[1]).toBeCloseTo(0, 9);
    // And it's different from the flat case — the whole point of this test.
    expect(tilted.spruePos[1]).not.toBeCloseTo(flat.spruePos[1], 3);
  });

  it('lifts sprue onto the tilted plane (signedDistance ≈ 0)', () => {
    const b = bbox([-10, -10, -10], [10, 10, 10]);
    const moldMin = new THREE.Vector3(-15, -15, -15);
    const moldSize = new THREE.Vector3(30, 30, 30);
    const geo = new THREE.BufferGeometry();
    // A handful of vertices, at least one in the top half
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 5,
      2, 2, 4,
      -3, 1, 3,
    ]), 3));
    const result = computeChannelPositions(b, 'z', 0, moldMin, moldSize, geo, 15);
    // Sprue must sit on the tilted plane: normal·sprue - originOffset = 0.
    // For Z/15° with pivot origin: -sin15*y + cos15*z ≈ 0.
    const s = Math.sin(15 * Math.PI / 180);
    const c = Math.cos(15 * Math.PI / 180);
    const [_sx, sy, sz] = result.spruePos;
    expect(-s * sy + c * sz).toBeCloseTo(0, 9);
    // Sprue height > 0 and matches topFaceVal - sprueZ
    expect(result.sprueHeight).toBeCloseTo(15 - sz, 6); // moldMin.z + moldSize.z = 15
    expect(result.sprueHeight).toBeGreaterThan(0);
  });

  it('returns the same axis-aligned rotation under tilt (v1 channel orientation is axis-aligned)', () => {
    // v1 intentionally keeps cylinders oriented along the split axis even under
    // tilt — see channelPlacement module header. This locks in that decision.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, 5, 1, 1, 4, -1, -1, 3,
    ]), 3));
    const b = bbox([-10, -10, -10], [10, 10, 10]);
    const result = computeChannelPositions(
      b, 'z', 0, new THREE.Vector3(-15, -15, -15), new THREE.Vector3(30, 30, 30), geo, 20,
    );
    expect(result.rotation).toEqual([0, 0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Area-weighting (fix for tessellation-density bias)
// ─────────────────────────────────────────────────────────────────────────
//
// These tests lock in the 2026-04 change from vertex-averaged to
// area-weighted sprue centroid. Without the fix, a sparsely-tessellated
// large face and a densely-tessellated small face would be weighted by
// their vertex count, pulling the sprue toward wherever the mesh was
// refined — not toward the actual bulk of the part.

describe('sprue centroid is area-weighted (not vertex-count-weighted)', () => {
  it('a single big triangle outweighs a cluster of many tiny triangles on the other side', () => {
    // SCENARIO: Top half (z > 0) contains two patches:
    //   Patch L ("Large"): ONE big triangle centered at (-10, 0) in XY, area ~200
    //   Patch S ("Small"): 50 tiny triangles clustered near (+10, 0), total area ~2
    // Vertex counts: L = 3 vertices, S = 150 vertices (50×3 non-indexed).
    //
    // Vertex-averaged centroid (old buggy behaviour):
    //   sprueX ≈ (3 * -10 + 150 * 10) / 153 ≈ +9.6 — pulled toward S
    // Area-weighted centroid (new correct behaviour):
    //   sprueX ≈ (200 * -10 + 2 * 10) / 202 ≈ -9.9 — pulled toward L, the
    //   actual bulk of material.
    const verts: number[] = [];

    // Patch L: one big triangle, centroid (-10, 0, 1). Area = |cross| / 2.
    // Vertices (-20, -10, 1), (0, -10, 1), (-10, 10, 1).
    verts.push(-20, -10, 1,  0, -10, 1,  -10, 10, 1);

    // Patch S: 50 tiny triangles, each centroid near (+10, 0, 1), each area ≈ 0.04.
    // All clustered in a 0.4×0.4 patch to keep total area small.
    for (let i = 0; i < 50; i++) {
      const dx = (i % 10) * 0.04; // 0..0.36
      const dy = Math.floor(i / 10) * 0.04;
      verts.push(
        10 + dx,       0 + dy,       1,
        10 + dx + 0.4, 0 + dy,       1,
        10 + dx,       0 + dy + 0.4, 1,
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    const b = bbox([-20, -10, -1], [20, 10, 1]);
    const moldMin = new THREE.Vector3(-25, -15, -5);
    const moldSize = new THREE.Vector3(50, 30, 10);

    const result = computeChannelPositions(b, 'z', 0, moldMin, moldSize, geo);
    // Area-weighted: sprue pulled toward patch L (negative X).
    expect(result.spruePos[0]).toBeLessThan(-5);
    // Sanity: NOT pulled toward S, which a vertex-counted centroid would do.
    expect(result.spruePos[0]).not.toBeGreaterThan(0);
  });

  it('symmetric equal-area triangles in the top half yield a centred sprue (no drift)', () => {
    // Two triangles forming a 2x2 quad centred on origin in XY, both at z=5.
    // Each triangle has the same area (2 sq units) and their centroids at
    // (+2/3, -2/3, 5) and (-2/3, +2/3, 5) balance to (0, 0, 5).
    // Both triangles' XY projections include the origin along the shared
    // diagonal, so the sprue-in-cavity verification passes.
    // Pre-fix (vertex-averaged) would also land at origin here — this test
    // is a regression shield proving that the area-weighting fix does NOT
    // break the symmetric case.
    const verts: number[] = [
      // Triangle 1: (-2,-2) (2,-2) (2,2). Centroid (2/3, -2/3, 5).
      -2, -2, 5,   2, -2, 5,   2, 2, 5,
      // Triangle 2: (-2,-2) (2,2) (-2,2). Centroid (-2/3, 2/3, 5).
      -2, -2, 5,   2, 2, 5,   -2, 2, 5,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    const b = bbox([-2, -2, 0], [2, 2, 10]);
    const moldMin = new THREE.Vector3(-3, -3, -3);
    const moldSize = new THREE.Vector3(6, 6, 16);

    const result = computeChannelPositions(b, 'z', 0, moldMin, moldSize, geo);
    // Perfectly centred — two equal-area, symmetric triangles.
    expect(result.spruePos[0]).toBeCloseTo(0, 9);
    expect(result.spruePos[1]).toBeCloseTo(0, 9);
  });

  it('falls back to bbox center when no triangles are in the top half', () => {
    // All triangles in bottom half (z < 0). Top half is empty → totalArea = 0
    // → fallback returns bbox center for the lateral axes. The sprue primary
    // axis still lifts to splitPos via the plane logic.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, -5,  1, 0, -5,  0, 1, -5,
    ]), 3));

    const b = bbox([-2, -2, -10], [2, 2, -1]);
    const moldMin = new THREE.Vector3(-3, -3, -11);
    const moldSize = new THREE.Vector3(6, 6, 20);

    const result = computeChannelPositions(b, 'z', 0, moldMin, moldSize, geo);
    // Sprue falls back to bbox center in XY (= 0, 0)
    expect(result.spruePos[0]).toBe(0);
    expect(result.spruePos[1]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sprue-inside-cavity verification (donut / C-shape correctness)
// ─────────────────────────────────────────────────────────────────────────
//
// The area-weighted surface centroid is mathematically correct but can fall
// in a HOLE for non-convex parts. Without verification, the sprue cylinder
// would carve through solid mold material without reaching the cavity —
// zero pour path. These tests lock in the post-centroid snap behaviour.

describe('sprue snaps to nearest material when centroid falls in a hole', () => {
  it('donut-shaped ring: surface centroid at origin (hole) snaps onto the ring', () => {
    // 8-segment annular ring in the z=5 plane, inner radius 2, outer radius 4.
    // Area-weighted centroid of the ring's TRIANGLES is the centre of the
    // ring (x=0, y=0), which is HOLLOW — no material there. The sprue-in-
    // cavity verification should detect this and snap to the nearest triangle
    // centroid, which sits on the ring itself at radius ~3 (mid-wall).
    const segments = 8;
    const rInner = 2, rOuter = 4;
    const z = 5;
    const verts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI;
      const pInner0 = [Math.cos(a0) * rInner, Math.sin(a0) * rInner, z];
      const pInner1 = [Math.cos(a1) * rInner, Math.sin(a1) * rInner, z];
      const pOuter0 = [Math.cos(a0) * rOuter, Math.sin(a0) * rOuter, z];
      const pOuter1 = [Math.cos(a1) * rOuter, Math.sin(a1) * rOuter, z];
      // Quad split into two triangles
      verts.push(...pInner0, ...pOuter0, ...pOuter1);
      verts.push(...pInner0, ...pOuter1, ...pInner1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    const b = bbox([-rOuter, -rOuter, 0], [rOuter, rOuter, 10]);
    const moldMin = new THREE.Vector3(-rOuter - 2, -rOuter - 2, -2);
    const moldSize = new THREE.Vector3(2 * rOuter + 4, 2 * rOuter + 4, 14);

    const result = computeChannelPositions(b, 'z', 0, moldMin, moldSize, geo);

    // Sprue MUST NOT sit at origin (the hole). It should sit on the ring at
    // radius somewhere between rInner and rOuter.
    const r = Math.sqrt(result.spruePos[0] ** 2 + result.spruePos[1] ** 2);
    expect(r).toBeGreaterThan(rInner * 0.9);
    expect(r).toBeLessThan(rOuter * 1.1);
    // Specifically, NOT at origin within any reasonable tolerance.
    expect(r).toBeGreaterThan(1);
  });

  it('solid disk: centroid sits at origin on the disk (verification passes, no snap)', () => {
    // Triangle fan forming a disk centred on origin, z=5, radius 4. Origin
    // is INSIDE the disk — verification should pass and leave the sprue at
    // origin. Confirms the verification isn't over-eager: it only snaps
    // when the centroid is truly off the material.
    const segments = 8;
    const r = 4;
    const z = 5;
    const verts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI;
      verts.push(0, 0, z);
      verts.push(Math.cos(a0) * r, Math.sin(a0) * r, z);
      verts.push(Math.cos(a1) * r, Math.sin(a1) * r, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    const b = bbox([-r, -r, 0], [r, r, 10]);
    const moldMin = new THREE.Vector3(-r - 2, -r - 2, -2);
    const moldSize = new THREE.Vector3(2 * r + 4, 2 * r + 4, 14);

    const result = computeChannelPositions(b, 'z', 0, moldMin, moldSize, geo);
    // Centroid of the disk IS the origin → verification passes → no snap.
    expect(result.spruePos[0]).toBeCloseTo(0, 5);
    expect(result.spruePos[1]).toBeCloseTo(0, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sprueOverride — user-specified sprue position bypasses auto-placement.
// ─────────────────────────────────────────────────────────────────────────
//
// Why these tests exist: the v1 UI lets the user punch in lateral (a, b)
// coordinates for the sprue. Three properties must hold:
//   1) Bit-exact respect — the returned spruePos lateral coords equal the
//      override coords, regardless of what the centroid would have been.
//   2) Cavity verification is BYPASSED — even overrides that land outside
//      the cavity are passed through. (The UI warns the user, but the
//      engine respects the instruction.)
//   3) No override = existing behavior is unchanged. Omitting opts, or
//      passing `{}`, must produce the same result the centroid path did
//      before this feature existed.

describe('computeChannelPositions — sprueOverride', () => {
  // Shared: a simple 8-tri disk at z=5, centered on origin. Same geometry
  // used by the cavity-verification tests, so we know the auto-centroid
  // lands at origin (verification passes) — giving us a stable baseline.
  function buildDiskGeometry(): {
    geo: THREE.BufferGeometry;
    bb: THREE.Box3;
    moldMin: THREE.Vector3;
    moldSize: THREE.Vector3;
  } {
    const segments = 8;
    const r = 4;
    const z = 5;
    const verts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI;
      verts.push(0, 0, z);
      verts.push(Math.cos(a0) * r, Math.sin(a0) * r, z);
      verts.push(Math.cos(a1) * r, Math.sin(a1) * r, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    return {
      geo,
      bb: bbox([-r, -r, 0], [r, r, 10]),
      moldMin: new THREE.Vector3(-r - 2, -r - 2, -2),
      moldSize: new THREE.Vector3(2 * r + 4, 2 * r + 4, 14),
    };
  }

  it('places sprue at the exact override lateral coords (skips centroid)', () => {
    const { geo, bb, moldMin, moldSize } = buildDiskGeometry();

    // Override to a point OFF origin (the auto centroid). If the override
    // is being honored, the returned sprue lands exactly here.
    const override = { a: 2.5, b: -1.7 };
    const result = computeChannelPositions(
      bb, 'z', 0, moldMin, moldSize, geo, 0, { sprueOverride: override },
    );

    // axis='z' → lateralA=0 (x), lateralB=1 (y)
    expect(result.spruePos[0]).toBeCloseTo(override.a, 6);
    expect(result.spruePos[1]).toBeCloseTo(override.b, 6);
    // Primary coord still lifted onto the axis-aligned plane (z = splitPos).
    expect(result.spruePos[2]).toBeCloseTo(0, 6);
  });

  it('bypasses cavity verification — override outside material is respected', () => {
    // Use the annular donut: its area-weighted centroid is the origin,
    // which is in the HOLE. Auto-placement snaps to the ring (tested
    // elsewhere); the override MUST not snap — even when outside material.
    const segments = 8;
    const rInner = 2;
    const rOuter = 4;
    const z = 5;
    const verts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI;
      const ix0 = Math.cos(a0) * rInner, iy0 = Math.sin(a0) * rInner;
      const ix1 = Math.cos(a1) * rInner, iy1 = Math.sin(a1) * rInner;
      const ox0 = Math.cos(a0) * rOuter, oy0 = Math.sin(a0) * rOuter;
      const ox1 = Math.cos(a1) * rOuter, oy1 = Math.sin(a1) * rOuter;
      verts.push(ix0, iy0, z, ox0, oy0, z, ox1, oy1, z);
      verts.push(ix0, iy0, z, ox1, oy1, z, ix1, iy1, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    const bb = bbox([-rOuter, -rOuter, 0], [rOuter, rOuter, 10]);
    const moldMin = new THREE.Vector3(-rOuter - 2, -rOuter - 2, -2);
    const moldSize = new THREE.Vector3(2 * rOuter + 4, 2 * rOuter + 4, 14);

    // Override to (0.1, 0.1) — clearly inside the hole. Auto mode would
    // snap this to the ring; the override path must leave it alone.
    const override = { a: 0.1, b: 0.1 };
    const result = computeChannelPositions(
      bb, 'z', 0, moldMin, moldSize, geo, 0, { sprueOverride: override },
    );

    expect(result.spruePos[0]).toBeCloseTo(override.a, 6);
    expect(result.spruePos[1]).toBeCloseTo(override.b, 6);
    // Sanity: the result did NOT drift onto the ring (radius ≥ rInner).
    const r = Math.hypot(result.spruePos[0], result.spruePos[1]);
    expect(r).toBeLessThan(rInner);
  });

  it('omitting opts leaves auto-placement behavior unchanged', () => {
    // Regression shield: calls without the opts arg, and calls with an
    // empty opts object, must both produce the same spruePos as the
    // auto-placement path. This guards against a refactor accidentally
    // short-circuiting the centroid computation when override is absent.
    const { geo, bb, moldMin, moldSize } = buildDiskGeometry();

    const auto = computeChannelPositions(bb, 'z', 0, moldMin, moldSize, geo);
    const autoExplicitEmpty = computeChannelPositions(
      bb, 'z', 0, moldMin, moldSize, geo, 0, {},
    );

    // Disk centroid is origin.
    expect(auto.spruePos[0]).toBeCloseTo(0, 5);
    expect(auto.spruePos[1]).toBeCloseTo(0, 5);
    // Passing {} must be bit-identical to passing nothing.
    expect(autoExplicitEmpty.spruePos).toEqual(auto.spruePos);
    expect(autoExplicitEmpty.sprueHeight).toBe(auto.sprueHeight);
    expect(autoExplicitEmpty.ventPositions).toEqual(auto.ventPositions);
  });

  it('override respects axis=y (lateral indices are 2 and 0)', () => {
    // Axis-mapping smoke test. For axis='y', lateralA = 2 (z), lateralB = 0
    // (x). If override.a/b are wired through the wrong slots, this lands
    // at the wrong coords.
    const { geo, moldMin, moldSize } = buildDiskGeometry();
    // Y-axis split through the middle of the disk's bounding cube.
    const bb = bbox([-4, -1, 0], [4, 1, 10]);

    const override = { a: 7.5, b: 1.25 }; // a → z, b → x
    const result = computeChannelPositions(
      bb, 'y', 0, moldMin, moldSize, geo, 0, { sprueOverride: override },
    );

    // axis='y' → lateralA=2 (z), lateralB=0 (x)
    expect(result.spruePos[2]).toBeCloseTo(override.a, 6); // z
    expect(result.spruePos[0]).toBeCloseTo(override.b, 6); // x
    // Primary axis (y) lifted onto the plane — splitPos=0 for axis-aligned.
    expect(result.spruePos[1]).toBeCloseTo(0, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shape-aware cross-section math (added in rebase merge)
// ─────────────────────────────────────────────────────────────────────────────

describe('clampToMoldInterior', () => {
  const rectBbox = bbox([0, 0, 0], [10, 10, 10]);

  it('is a no-op for points already well inside a rect mold', () => {
    const env = computeMoldEnvelope(rectBbox, 'rect', 'z', 2);
    const [a, b] = clampToMoldInterior(5, 5, env, 1);
    expect(a).toBe(5);
    expect(b).toBe(5);
  });

  it('pulls rect out-of-bounds points back inside by the margin', () => {
    const env = computeMoldEnvelope(rectBbox, 'rect', 'z', 2);
    // env covers [-2, 12] × [-2, 12] laterally; margin=1 → safe [-1, 11]
    const [a, b] = clampToMoldInterior(100, -100, env, 1);
    expect(a).toBe(11);
    expect(b).toBe(-1);
  });

  it('collapses to axis center when margin exceeds half the rect (degenerate input, no NaNs)', () => {
    const env = computeMoldEnvelope(rectBbox, 'rect', 'z', 2);
    const [a, b] = clampToMoldInterior(5, 5, env, 100);
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
    expect(a).toBeCloseTo(5, 5);
    expect(b).toBeCloseTo(5, 5);
  });

  it('clamps to the circle for cylinder molds (radial projection)', () => {
    const env = computeMoldEnvelope(rectBbox, 'cylinder', 'z', 2);
    const expectedR = env.cylinderRadius! - 1;
    const [a, b] = clampToMoldInterior(100, 5, env, 1);
    expect(a).toBeCloseTo(5 + expectedR, 4);
    expect(b).toBeCloseTo(5, 4);
  });

  it('cylinder clamp is a no-op for points inside the safe circle', () => {
    const env = computeMoldEnvelope(rectBbox, 'cylinder', 'z', 2);
    const [a, b] = clampToMoldInterior(5.1, 5.2, env, 1);
    expect(a).toBe(5.1);
    expect(b).toBe(5.2);
  });

  it('handles the cylinder center point (radius 0 / avoids div-by-zero)', () => {
    const env = computeMoldEnvelope(rectBbox, 'cylinder', 'z', 2);
    const [a, b] = clampToMoldInterior(5, 5, env, 1);
    expect(a).toBe(5);
    expect(b).toBe(5);
  });

  it('roundedRect clamp uses max(margin, cornerRadius) so channels avoid the rounded cutout', () => {
    const env = computeMoldEnvelope(rectBbox, 'roundedRect', 'z', 10);
    const r = env.cornerRadius!;
    expect(r).toBeGreaterThan(0);
    const [a, b] = clampToMoldInterior(999, 999, env, 0.1);
    expect(a).toBeCloseTo(20 - r, 5);
    expect(b).toBeCloseTo(20 - r, 5);
  });
});

describe('fallbackVentSeeds', () => {
  const b = bbox([-5, -5, -5], [5, 5, 5]);

  it('rect seeds are the four bbox corners (legacy behaviour preserved)', () => {
    const env = computeMoldEnvelope(b, 'rect', 'z', 2);
    const seeds = fallbackVentSeeds(env, b, 0);
    expect(seeds).toHaveLength(4);
    const corners = new Set(seeds.map(s => s.join(',')));
    expect(corners.has('-5,-5')).toBe(true);
    expect(corners.has('5,5')).toBe(true);
    expect(corners.has('-5,5')).toBe(true);
    expect(corners.has('5,-5')).toBe(true);
  });

  it('cylinder seeds are four points inside the inscribed square (never outside the radius)', () => {
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 2);
    const r = env.cylinderRadius!;
    const cA = env.cylinderCenterLatA!;
    const cB = env.cylinderCenterLatB!;
    const margin = 0.5;
    const seeds = fallbackVentSeeds(env, b, margin);
    expect(seeds).toHaveLength(4);
    for (const [a, bb] of seeds) {
      const dist = Math.hypot(a - cA, bb - cB);
      expect(dist).toBeLessThanOrEqual(r - margin + 1e-9);
    }
  });
});

describe('computeChannelPositionsForEnvelope', () => {
  function offCenterDiscGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = (i / 100) * Math.PI * 2;
      const r = 4;
      verts.push(r * Math.cos(t) + 2, r * Math.sin(t), 0);
      verts.push(r * Math.cos(t) + 2, r * Math.sin(t), 3);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    return geo;
  }

  it('sprue stays inside a cylinder mold even when the part centroid is near the wall', () => {
    const geo = offCenterDiscGeometry();
    const b = new THREE.Box3().setFromBufferAttribute(
      geo.attributes.position as THREE.BufferAttribute,
    );
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 1);

    const result = computeChannelPositionsForEnvelope(env, b, 1.5, geo, {
      sprueMargin: 1.2,
      ventMargin: 0.3,
    });

    const cA = env.cylinderCenterLatA!;
    const cB = env.cylinderCenterLatB!;
    const rSafe = env.cylinderRadius! - 1.2;
    const [sx, sy] = [result.spruePos[0], result.spruePos[1]];
    const dist = Math.hypot(sx - cA, sy - cB);
    expect(dist).toBeLessThanOrEqual(rSafe + 1e-6);
  });

  it('every vent position sits inside a cylinder mold (no wall breakouts)', () => {
    const geo = offCenterDiscGeometry();
    const b = new THREE.Box3().setFromBufferAttribute(
      geo.attributes.position as THREE.BufferAttribute,
    );
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 1);
    const result = computeChannelPositionsForEnvelope(env, b, 1.5, geo, {
      sprueMargin: 1.2,
      ventMargin: 0.4,
    });

    const cA = env.cylinderCenterLatA!;
    const cB = env.cylinderCenterLatB!;
    const rSafe = env.cylinderRadius! - 0.4;
    for (const v of result.ventPositions) {
      const dist = Math.hypot(v[0] - cA, v[1] - cB);
      expect(dist).toBeLessThanOrEqual(rSafe + 1e-6);
    }
  });

  it('falls back to shape-aware seeds when geometry yields no vent candidates', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 1]), 3),
    );
    const b = bbox([-5, -5, -5], [5, 5, 5]);
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 1);
    const result = computeChannelPositionsForEnvelope(env, b, 0, geo, {
      sprueMargin: 0.1,
      ventMargin: 0.1,
    });
    expect(result.ventPositions.length).toBeGreaterThanOrEqual(2);
    const rSafe = env.cylinderRadius! - 0.1;
    for (const v of result.ventPositions) {
      expect(Math.hypot(v[0] - env.cylinderCenterLatA!, v[1] - env.cylinderCenterLatB!))
        .toBeLessThanOrEqual(rSafe + 1e-6);
    }
  });

  it('rect envelope with zero margins matches the legacy computeChannelPositions output', () => {
    const geo = offCenterDiscGeometry();
    const b = new THREE.Box3().setFromBufferAttribute(
      geo.attributes.position as THREE.BufferAttribute,
    );
    const env = computeMoldEnvelope(b, 'rect', 'z', 2);

    const legacy = computeChannelPositions(b, 'z', 1.5, env.moldMin, env.moldSize, geo);
    const shaped = computeChannelPositionsForEnvelope(env, b, 1.5, geo, {
      sprueMargin: 0, ventMargin: 0,
    });

    expect(shaped.spruePos).toEqual(legacy.spruePos);
    expect(shaped.sprueHeight).toBe(legacy.sprueHeight);
    expect(shaped.rotation).toEqual(legacy.rotation);
    expect(shaped.ventPositions).toEqual(legacy.ventPositions);
  });
});
