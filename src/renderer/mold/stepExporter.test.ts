// Unit tests for exportSTEP. First test-run loads 66 MB of WASM, subsequent
// runs in the same process are fast due to the ocpModule singleton. Kept in
// its own file so the fast exporters.test.ts suite doesn't pay the WASM cost.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { exportSTEP } from './stepExporter';
import { getManifold, manifoldToGeometry } from './manifoldBridge';

/** Simple single-triangle geometry — for the "minimum viable input" smoke. */
function oneTriangle(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([
    0, 0, 0,
    10, 0, 0,
    0, 10, 0,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

describe('exportSTEP', () => {
  it('produces a valid ISO 10303-21 file from a Manifold-generated cube', async () => {
    // Using a Manifold cube (12 triangles, watertight) rather than a hand-
    // built single triangle because the main use case is Manifold-sourced
    // meshes from generateMold. If the pipeline works end-to-end for a cube,
    // it'll work for any reasonable mold mesh.
    const wasm = await getManifold();
    const cube = wasm.Manifold.cube([10, 20, 30], false);
    const geo = manifoldToGeometry(cube);

    const buf = await exportSTEP(geo);
    expect(buf.byteLength).toBeGreaterThan(0);

    const text = new TextDecoder().decode(buf);
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toContain('HEADER;');
    expect(text).toContain('DATA;');
    expect(text).toContain('ENDSEC;');
    expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);

    // A sewn shell surfaces as one of these entity types in STEP output.
    const hasBRepEntity =
      text.includes('MANIFOLD_SOLID_BREP') ||
      text.includes('SHELL_BASED_SURFACE_MODEL') ||
      text.includes('CLOSED_SHELL') ||
      text.includes('OPEN_SHELL') ||
      text.includes('ADVANCED_BREP_SHAPE_REPRESENTATION');
    expect(hasBRepEntity).toBe(true);
  }, 120_000);

  it('accepts a minimal single-triangle mesh', async () => {
    const buf = await exportSTEP(oneTriangle());
    const text = new TextDecoder().decode(buf);
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  }, 60_000);

  it('rejects an empty mesh with a descriptive error', async () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([]), 3));
    await expect(exportSTEP(geo)).rejects.toThrow(/no triangles/);
  });

  it('rejects a mesh exceeding the maxTriangles soft limit', async () => {
    // Build a geometry with 11 triangles but pass maxTriangles=10.
    const N = 11;
    const positions = new Float32Array(N * 9);
    // Any coordinates are fine — we expect rejection before BRep construction.
    for (let i = 0; i < N * 9; i++) positions[i] = i;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    await expect(exportSTEP(geo, { maxTriangles: 10 })).rejects.toThrow(
      /has 11 triangles \(max 10\)/,
    );
  });

  it('honours a custom tolerance (runs without error on slightly noisy input)', async () => {
    // Build a triangle with one vertex shifted by ~1e-4 — within a 1e-3
    // tolerance but outside the default OCCT 1e-6. We just check it doesn't
    // crash; no silent fallback to a different tolerance.
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([
      0, 0, 0,
      10 + 1e-4, 0, 0,
      0, 10, 0,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const buf = await exportSTEP(geo, { tolerance: 1e-3 });
    expect(buf.byteLength).toBeGreaterThan(0);
  }, 60_000);
});
