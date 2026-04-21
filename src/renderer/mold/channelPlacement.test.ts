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
    expect(getRotationForAxis('y')).toEqual([90, 0, 0]);
    expect(getRotationForAxis('z')).toEqual([0, 0, 0]);
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
    expect(result.rotation).toEqual([90, 0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shape-aware clamp + fallback seeds
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
    // lateral half-extent = 7, margin 100 is absurd
    const [a, b] = clampToMoldInterior(5, 5, env, 100);
    // Expect the center, not NaN or inverted range.
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
    expect(a).toBeCloseTo(5, 5);
    expect(b).toBeCloseTo(5, 5);
  });

  it('clamps to the circle for cylinder molds (radial projection)', () => {
    const env = computeMoldEnvelope(rectBbox, 'cylinder', 'z', 2);
    // cylinder center = (5,5), radius ≈ sqrt(50)+2 ≈ 9.071
    // Point at (100, 5) → far outside along +x. Should land on the circle
    // of radius (radius − margin=1) ≈ 8.071, at angle 0 → (5+8.071, 5).
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
    // Big wall → cornerRadius > default margin
    const env = computeMoldEnvelope(rectBbox, 'roundedRect', 'z', 10);
    const r = env.cornerRadius!;
    expect(r).toBeGreaterThan(0);
    // Env AABB spans [-10, 20] × [-10, 20]; with effective margin = max(0.1, r),
    // the safe zone is inset by r. A point at (+999, +999) lands at max corner - r.
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
    // With margin=0, the bbox corners sit inside the rect env, so they stay put.
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
    // Non-zero margin so seeds land strictly inside — matches real callers,
    // which always pass ventMargin = ventRadius + safetyWall > 0.
    const margin = 0.5;
    const seeds = fallbackVentSeeds(env, b, margin);
    expect(seeds).toHaveLength(4);
    for (const [a, bb] of seeds) {
      const dist = Math.hypot(a - cA, bb - cB);
      expect(dist).toBeLessThanOrEqual(r - margin + 1e-9);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeChannelPositionsForEnvelope — shape-aware channel math
// ─────────────────────────────────────────────────────────────────────────────

describe('computeChannelPositionsForEnvelope', () => {
  // A simple part: 100 random-ish vertices in a thin disc biased toward +x
  // (centroid lands off-axis, which is what makes clamping matter).
  function offCenterDiscGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const verts: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = (i / 100) * Math.PI * 2;
      // Mostly in the +x half → centroid biased off-axis.
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
    // Thin wall → cylinder only barely bigger than the part.
    const env = computeMoldEnvelope(b, 'cylinder', 'z', 1);

    // Sprue margin chosen to force inward clamping for any vertex-centroid
    // that sits near the part's outer bounds.
    const result = computeChannelPositionsForEnvelope(env, b, 1.5, geo, {
      sprueMargin: 1.2,
      ventMargin: 0.3,
    });

    const cA = env.cylinderCenterLatA!;
    const cB = env.cylinderCenterLatB!;
    const rSafe = env.cylinderRadius! - 1.2;
    const [sx, sy] = [result.spruePos[0], result.spruePos[1]];
    const dist = Math.hypot(sx - cA, sy - cB);
    // 1e-6 fudge: clamp is floating point and we want to tolerate equality at the boundary.
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
    // A degenerate "part" with only one vertex in the top half — nothing for
    // the extremity search to cluster. Must still produce ≥ MIN_VENTS vents
    // from fallback seeds, all inside the cylinder.
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
    // Regression guard: the shape-unaware shim wraps the envelope variant
    // with a rect env + zero margins. The two must agree byte-for-byte.
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
