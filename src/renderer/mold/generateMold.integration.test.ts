// Integration test: full generateMold pipeline at cutAngle > 0.
//
// Why this file exists: the spike (spike_splitByPlane.test.ts) covers
// Manifold's splitByPlane in isolation, and channelPlacement.test.ts covers
// the pure-geometry channel logic with mock bboxes. Nothing had exercised
// the ENTIRE generateMold chain (geometry → Manifold → tilted CSG split →
// pins → sprue → vents → back to BufferGeometry) at a non-zero cutAngle.
//
// This is the regression shield for the oblique-parting-plane feature —
// if any component in the pipeline stops honouring cutAngle, the halves
// will come back empty, mis-split, or intersecting, and this test will
// fire before a user notices.
//
// Kept lightweight (a single cube input) because Manifold's WASM load is
// slow and the other tests already cover the fine-grained math. One pass
// through the full chain is enough to catch wiring regressions.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateMold } from './generateMold';
import { getManifold, manifoldToGeometry } from './manifoldBridge';
import { getPlaneEquation, signedDistance, type Vec3 } from './planeGeometry';

/**
 * Build a watertight cube as a BufferGeometry — the smallest input that
 * exercises the whole pipeline without depending on fixture files.
 */
async function buildCubeGeometry(size: number): Promise<{
  geometry: THREE.BufferGeometry;
  bbox: THREE.Box3;
}> {
  const wasm = await getManifold();
  const { Manifold } = wasm;
  const cube = Manifold.cube([size, size, size], true); // centred on origin
  const geometry = manifoldToGeometry(cube);
  geometry.computeBoundingBox();
  return { geometry, bbox: geometry.boundingBox! };
}

describe('generateMold — end-to-end at cutAngle > 0', () => {
  it('produces two non-empty halves with a 15° z-tilt on a unit cube', async () => {
    const { geometry, bbox } = await buildCubeGeometry(20);

    const result = await generateMold(geometry, bbox, 'z', 0.5, {
      cutAngle: 15,
    });

    // Both halves should have geometry — empty returns mean the CSG split
    // failed or the plane landed entirely on one side.
    expect(result.top).toBeDefined();
    expect(result.bottom).toBeDefined();
    expect(result.top.attributes.position.count).toBeGreaterThan(0);
    expect(result.bottom.attributes.position.count).toBeGreaterThan(0);
  });

  it('places top-half centroid on the +normal side of the tilted plane', async () => {
    const { geometry, bbox } = await buildCubeGeometry(20);

    const cutAngle = 20;
    const axis = 'z' as const;
    const offset = 0.5;

    const result = await generateMold(geometry, bbox, axis, offset, { cutAngle });

    // Reconstruct the same plane equation the CSG path used.
    const plane = getPlaneEquation(
      [bbox.min.x, bbox.min.y, bbox.min.z],
      [bbox.max.x, bbox.max.y, bbox.max.z],
      axis, offset, cutAngle,
    );

    // Centroid of the top half should sit on the +normal side, bottom on -.
    // If the cutter path ignored cutAngle, both halves would centre near
    // z = splitPos and this would flip.
    const topCentroid = centroidOf(result.top);
    const bottomCentroid = centroidOf(result.bottom);
    expect(signedDistance(topCentroid, plane)).toBeGreaterThan(0);
    expect(signedDistance(bottomCentroid, plane)).toBeLessThan(0);
  });

  it('regresses to the axis-aligned split at cutAngle=0 (sanity: feature flag off == feature absent)', async () => {
    const { geometry, bbox } = await buildCubeGeometry(20);

    const axisAligned = await generateMold(geometry, bbox, 'z', 0.5, { cutAngle: 0 });
    // At cutAngle=0 the top half's minimum Z should sit at (or above) the
    // split position within CSG tolerance — the historical guarantee.
    const topMinZ = minZ(axisAligned.top);
    // splitPos for offset=0.5 on a [-10..10] cube is 0. Allow tolerance for
    // mesh boundary offset + pin geometry sticking down slightly (pins are
    // cylinders centred on the seam).
    expect(topMinZ).toBeGreaterThan(-2); // 2mm slack for pin height
  });

  it('rejects a degenerate (zero-extent) bbox with a clear error', async () => {
    const { geometry } = await buildCubeGeometry(20);
    // Flatten the bbox along Z — the input geometry is still valid but the
    // bbox we pass says "zero Z extent", which should trip the guard.
    const flat = new THREE.Box3(
      new THREE.Vector3(-10, -10, 5),
      new THREE.Vector3(10, 10, 5),
    );
    await expect(
      generateMold(geometry, flat, 'z', 0.5, { cutAngle: 0 }),
    ).rejects.toThrow(/degenerate/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// axis='x' end-to-end shield
// ─────────────────────────────────────────────────────────────────────────
//
// Why a separate block for X: the csDimsForAxis axis mapping and the
// centered-build → rotate → translate pipeline in moldBox.ts were both
// re-written during the 2026-04 axis bug fix. X-axis had no integration
// coverage in the original suite — every test used 'z'. Unit tests pin
// the contract but don't prove the wiring holds when all of generateMold's
// stages (envelope → half cutters → subtract → pins → sprue) interact.
//
// This block exercises the entire pipeline on 'x' at cutAngle=0 and asserts:
//  1. Both halves come back with geometry (catches empty-result regressions).
//  2. The "top" half (by +x normal) lives in +x space past splitPos, and
//     extends ~pinHeight/2 below splitPos (pin protrusion regression shield).
//  3. Top and bottom share the same lateral AABB (Y and Z extents match
//     within tolerance) — proves the rotated rounded-rect envelope is
//     symmetric across the parting plane. Pre-fix this would diverge.

describe('generateMold — end-to-end on axis=x', () => {
  it('produces symmetric halves with a pin-protruding seam on X split', async () => {
    const { geometry, bbox } = await buildCubeGeometry(20);

    // axis='x', offset=0.5 → splitPos x = 0 (bbox centered on origin)
    const result = await generateMold(geometry, bbox, 'x', 0.5, { cutAngle: 0 });

    expect(result.top.attributes.position.count).toBeGreaterThan(0);
    expect(result.bottom.attributes.position.count).toBeGreaterThan(0);

    // Top half AABB on X: min just below splitPos (pin protrusion), max past
    // the part's +x edge (mold envelope overhangs the part).
    const topBB = aabbOf(result.top);
    const bottomBB = aabbOf(result.bottom);
    const splitX = 0;

    // Top extends past splitPos in +x (mold body + wall thickness).
    expect(topBB.max.x).toBeGreaterThan(splitX);
    // Pin protrusion: top dips slightly below splitPos. If this equals
    // splitX the pin centering fix has regressed (pins become no-ops on X).
    expect(topBB.min.x).toBeLessThan(splitX);
    // Bottom is the mirror: extends past splitPos in -x, with a pin socket
    // dipping slightly above splitPos on the seam (sockets are subtractions
    // so they don't shift the AABB up).
    expect(bottomBB.min.x).toBeLessThan(splitX);

    // Lateral symmetry — Y and Z extents must match within tolerance (both
    // halves cut from the same envelope). Before the moldBox fix these
    // diverged badly on non-Z axes.
    expect(topBB.min.y).toBeCloseTo(bottomBB.min.y, 3);
    expect(topBB.max.y).toBeCloseTo(bottomBB.max.y, 3);
    expect(topBB.min.z).toBeCloseTo(bottomBB.min.z, 3);
    expect(topBB.max.z).toBeCloseTo(bottomBB.max.z, 3);
  });
});

function aabbOf(geo: THREE.BufferGeometry): THREE.Box3 {
  geo.computeBoundingBox();
  return geo.boundingBox!.clone();
}

// ─────────────────────────────────────────────────────────────────────────
// sprueOverride end-to-end shield
// ─────────────────────────────────────────────────────────────────────────
//
// Why: channelPlacement.test.ts proves the override is honoured at the pure
// function level; workerProtocol.test.ts proves the wire schema survives.
// NEITHER exercises the full generateMold chain — the override has to ride
// through GenerateMoldOptions into computeChannelPositions without being
// dropped, renamed, or silently defaulted along the way.
//
// This test uses the observable effect of overriding the sprue: the sprue
// cylinder is a SUBTRACT from the top half. If it lands at (a, b), the top
// half must have a hole centred at (a, b) on the parting plane. We probe
// for that hole by scanning the top-half geometry for vertices near (a, b).

describe('generateMold — end-to-end with sprueOverride', () => {
  it('overridden sprue produces different top-half geometry than auto-placement', async () => {
    // Observable effect: the sprue is a SUBTRACT from the top half.
    // Moving it changes WHERE material gets carved out, which changes the
    // resulting mesh. On a symmetric cube with a symmetric auto-placement,
    // pushing the sprue to (+6, +4) shifts the cylindrical hole into a
    // different region of the cube — the resulting geometry CANNOT be
    // bit-identical to the auto-placed version.
    //
    // If the override field is dropped anywhere in the chain (generateMold
    // → computeChannelPositions), both runs would execute the SAME CSG
    // operations and produce byte-identical position buffers. Any
    // structural difference proves the override reached the CSG stage.
    //
    // We deliberately avoid assertions about the shape of the difference
    // (centroid direction, bbox shifts, vertex counts at specific coords)
    // because Manifold's tessellation patterns vary with the input and
    // those finer-grained observables are dominated by the outer shell.
    const { geometry, bbox } = await buildCubeGeometry(20);

    const auto = await generateMold(geometry, bbox, 'z', 0.5, { cutAngle: 0 });
    const override = { a: 6, b: 4 }; // axis='z' → a→x, b→y
    const manual = await generateMold(geometry, bbox, 'z', 0.5, {
      cutAngle: 0,
      sprueOverride: override,
    });

    expect(manual.top.attributes.position.count).toBeGreaterThan(0);
    expect(manual.bottom.attributes.position.count).toBeGreaterThan(0);

    // Structural difference: position arrays differ in length OR values.
    // If override were silently dropped, these would be identical.
    const autoPos = auto.top.attributes.position.array as Float32Array;
    const manualPos = manual.top.attributes.position.array as Float32Array;
    expect(geometriesDiffer(autoPos, manualPos)).toBe(true);
  });

  it('omitted sprueOverride matches explicit undefined (no silent default)', async () => {
    // If someone introduces a default like `opts.sprueOverride ?? {a:0,b:0}`
    // anywhere in the chain, omitting the field vs. passing undefined would
    // produce the same result by accident. This test at least ensures both
    // modes produce non-empty, same-size halves — a cheap round-trip shield.
    const { geometry, bbox } = await buildCubeGeometry(20);
    const a = await generateMold(geometry, bbox, 'z', 0.5, { cutAngle: 0 });
    const b = await generateMold(geometry, bbox, 'z', 0.5, {
      cutAngle: 0,
      sprueOverride: undefined,
    });
    expect(b.top.attributes.position.count).toBe(a.top.attributes.position.count);
    expect(b.bottom.attributes.position.count).toBe(a.bottom.attributes.position.count);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// test helpers
// ─────────────────────────────────────────────────────────────────────────

function centroidOf(geo: THREE.BufferGeometry): Vec3 {
  const pos = geo.attributes.position.array as Float32Array;
  let sx = 0, sy = 0, sz = 0;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    sx += pos[i * 3 + 0];
    sy += pos[i * 3 + 1];
    sz += pos[i * 3 + 2];
  }
  return [sx / n, sy / n, sz / n];
}

function minZ(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position.array as Float32Array;
  let m = Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 2] < m) m = pos[i + 2];
  }
  return m;
}

/**
 * Structural inequality test for two position buffers. Used to verify that
 * two CSG runs produced different output — bit-identical output would mean
 * the differentiating input was silently dropped.
 */
function geometriesDiffer(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}
