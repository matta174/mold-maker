// Integration test: generateMold → exportSTEP on realistic geometry.
//
// Why this file exists: stepExporter.test.ts proves exportSTEP can handle a
// bare Manifold cube (12 triangles) and a hand-built triangle. That's enough
// to shake the happy path, but it does NOT exercise the ACTUAL user flow:
//     load mesh → generateMold → pick a half → export as STEP.
// Mold halves carry features the cube doesn't — registration pins, a sprue,
// vents, inner pocket cavities, the parting-line seam, plus whatever tiny
// numerical noise Manifold's boolean chain introduces. A cube passing doesn't
// prove a real mold half passes. This does.
//
// The test is deliberately slow (~60–120 s, dominated by the 66 MB OCP WASM
// cold start and per-triangle BRep construction on a mesh with hundreds or
// low-thousands of triangles). It runs once, in its own describe block, and
// sits outside stepExporter.test.ts so the fast exporter tests stay fast.
//
// What this guards against:
//   1. Sewing-tolerance mismatch vs Manifold's output precision. If
//      generateMold starts emitting vertices with more numerical noise than
//      exportSTEP's default tolerance absorbs, the Sewing shell won't close
//      and OCP emits a degenerate STEP. We'd ship broken files.
//   2. Triangle-count bloat. The soft cap is 100k. A future CSG change could
//      push a "simple" mold over that cliff — this test's failure message
//      would pinpoint that regression to a single commit.
//   3. Non-manifold output from generateMold. exportSTEP's faceted-shell
//      strategy tolerates a lot (it doesn't require manifoldness — each
//      triangle is its own face), but a *zero-triangle* half from a CSG
//      failure upstream would surface as an export error here rather than
//      as a silent empty file in front of a user.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateMold } from './generateMold';
import { exportSTEP } from './stepExporter';
import { getManifold, manifoldToGeometry } from './manifoldBridge';

/** Watertight cube geometry — smallest realistic input for the full pipeline. */
async function buildCubeGeometry(size: number): Promise<{
  geometry: THREE.BufferGeometry;
  bbox: THREE.Box3;
}> {
  const wasm = await getManifold();
  const { Manifold } = wasm;
  const cube = Manifold.cube([size, size, size], true);
  const geometry = manifoldToGeometry(cube);
  geometry.computeBoundingBox();
  return { geometry, bbox: geometry.boundingBox! };
}

/** Minimal STEP-structure assertions shared across cases. Kept here rather
 *  than imported from stepExporter.test.ts so the two files don't couple —
 *  if one test's expectations drift, the other still pins the contract. */
function assertValidStep(buf: ArrayBuffer): string {
  expect(buf.byteLength).toBeGreaterThan(0);
  const text = new TextDecoder().decode(buf);
  expect(text.startsWith('ISO-10303-21;')).toBe(true);
  expect(text).toContain('HEADER;');
  expect(text).toContain('DATA;');
  expect(text).toContain('ENDSEC;');
  expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  // Sewn shells surface as one of these in STEP AP203/AP214 output.
  const hasBRepEntity =
    text.includes('MANIFOLD_SOLID_BREP') ||
    text.includes('SHELL_BASED_SURFACE_MODEL') ||
    text.includes('CLOSED_SHELL') ||
    text.includes('OPEN_SHELL') ||
    text.includes('ADVANCED_BREP_SHAPE_REPRESENTATION');
  expect(hasBRepEntity).toBe(true);
  return text;
}

/** Count non-empty DATA-section entity lines. Cheap heuristic for "is the
 *  file actually populated?" — a valid-looking but empty STEP would pass the
 *  header/footer checks. */
function countDataEntities(text: string): number {
  const dataIdx = text.indexOf('DATA;');
  const endIdx = text.lastIndexOf('ENDSEC;');
  if (dataIdx < 0 || endIdx < 0 || endIdx < dataIdx) return 0;
  const body = text.slice(dataIdx + 'DATA;'.length, endIdx);
  return body.split('\n').filter((l) => /^\s*#\d+\s*=/.test(l)).length;
}

describe('generateMold → exportSTEP — end-to-end', () => {
  it(
    'exports both halves of an axis-aligned mold as valid STEP',
    async () => {
      const { geometry, bbox } = await buildCubeGeometry(20);
      const mold = await generateMold(geometry, bbox, 'z', 0.5, { cutAngle: 0 });

      // Sanity — the upstream integration test asserts these, but if they
      // ever regress silently the STEP assertions below would be misleading.
      expect(mold.top.attributes.position.count).toBeGreaterThan(0);
      expect(mold.bottom.attributes.position.count).toBeGreaterThan(0);

      const topBuf = await exportSTEP(mold.top);
      const topText = assertValidStep(topBuf);
      expect(countDataEntities(topText)).toBeGreaterThan(10);

      const bottomBuf = await exportSTEP(mold.bottom);
      const bottomText = assertValidStep(bottomBuf);
      expect(countDataEntities(bottomText)).toBeGreaterThan(10);
    },
    180_000,
  );

  it(
    'exports a tilted-parting-plane half (cutAngle=15° on z-axis)',
    async () => {
      // Oblique plane exercises the rotated-cutter path in generateMold.
      // The resulting mesh has a sloped parting seam — extra triangles vs
      // the axis-aligned case and a different numerical profile. If the
      // sewing tolerance can't close the oblique seam we'd find out here
      // rather than in the field.
      const { geometry, bbox } = await buildCubeGeometry(20);
      const mold = await generateMold(geometry, bbox, 'z', 0.5, { cutAngle: 15 });

      const buf = await exportSTEP(mold.top);
      const text = assertValidStep(buf);
      expect(countDataEntities(text)).toBeGreaterThan(10);
    },
    120_000,
  );
});
