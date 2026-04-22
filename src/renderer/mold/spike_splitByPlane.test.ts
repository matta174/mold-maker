// Manifold-WASM splitByPlane contract tests.
//
// Originally a spike to de-risk the oblique-parting-plane refactor; retained
// as a permanent regression shield because nothing else in the test suite
// exercises Manifold's `splitByPlane(normal, originOffset)` API directly.
// `generateMold.integration.test.ts` covers the full pipeline but would
// attribute a Manifold-side break to our own code; this file fingers the
// upstream immediately. The behaviours pinned here — volume conservation,
// determinism, and the "axis-aligned split via normal == box-intersect"
// equivalence — are load-bearing assumptions of the mold pipeline. If any
// of them regresses after a Manifold version bump, every oblique-cut mold
// silently produces wrong geometry.
//
// Do not delete — update the pinned normals/offsets if Manifold's API
// evolves, but keep the coverage.

import { describe, it, expect } from 'vitest';
import { getManifold } from './manifoldBridge';

describe('SPIKE: Manifold.splitByPlane on arbitrary normals', () => {
  it('axis-aligned normal [0,0,1] splits a cube 50/50 at origin', async () => {
    const wasm = await getManifold();
    const { Manifold } = wasm;

    const cube = Manifold.cube([10, 10, 10], true); // centered at origin, volume = 1000
    const [above, below] = cube.splitByPlane([0, 0, 1], 0);

    expect(above.volume()).toBeCloseTo(500, 1);
    expect(below.volume()).toBeCloseTo(500, 1);
    expect(above.volume() + below.volume()).toBeCloseTo(1000, 1);
  });

  it('tilted normal [sin30, 0, cos30] splits the cube at origin (still 50/50 by symmetry)', async () => {
    const wasm = await getManifold();
    const { Manifold } = wasm;

    const cube = Manifold.cube([10, 10, 10], true);
    const angleRad = (30 * Math.PI) / 180;
    const normal: [number, number, number] = [Math.sin(angleRad), 0, Math.cos(angleRad)];

    const [above, below] = cube.splitByPlane(normal, 0);

    expect(above.volume()).toBeCloseTo(500, 1);
    expect(below.volume()).toBeCloseTo(500, 1);
  });

  it('tilted normal with non-zero offset splits cube unevenly but conserves volume', async () => {
    const wasm = await getManifold();
    const { Manifold } = wasm;

    const cube = Manifold.cube([10, 10, 10], true); // centered, verts from -5 to +5
    const angleRad = (15 * Math.PI) / 180;
    const normal: [number, number, number] = [Math.sin(angleRad), 0, Math.cos(angleRad)];

    // Offset plane so it's off-center. Since normal is a unit vector and the
    // cube spans -5..+5 in each axis, originOffset=1 moves the plane 1 unit
    // along the normal direction.
    const [above, below] = cube.splitByPlane(normal, 1);

    // Regardless of how unevenly it splits, total volume must be conserved.
    expect(above.volume() + below.volume()).toBeCloseTo(1000, 1);
    // And the "above" half should be smaller (plane moved into positive side)
    expect(above.volume()).toBeLessThan(below.volume());
  });

  it('splitByPlane is deterministic — same input yields same vertex count', async () => {
    const wasm = await getManifold();
    const { Manifold } = wasm;

    const cube = Manifold.cube([10, 10, 10], true);
    const normal: [number, number, number] = [0.3, 0.4, 0.866]; // ~60° tilt in XYZ

    const [a1] = cube.splitByPlane(normal, 0);
    const [a2] = cube.splitByPlane(normal, 0);

    expect(a1.numVert()).toBe(a2.numVert());
    expect(a1.volume()).toBeCloseTo(a2.volume(), 3);
  });

  it('cutAngle=0 path is a true no-op: splitByPlane([0,0,1], z) === axis-aligned trim', async () => {
    const wasm = await getManifold();
    const { Manifold } = wasm;

    const cube = Manifold.cube([10, 10, 10], true);

    // "Old" path: intersect with a big box that covers z >= 2
    const oldTopBox = Manifold.cube([100, 100, 100], false).translate([-50, -50, 2]);
    const oldTop = cube.intersect(oldTopBox);

    // "New" path: splitByPlane
    const [newTop] = cube.splitByPlane([0, 0, 1], 2);

    expect(newTop.volume()).toBeCloseTo(oldTop.volume(), 2);
  });
});
