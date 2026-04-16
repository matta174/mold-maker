import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildDraftHeatmapGeometry,
  summarizeClassification,
  classifyScore,
  DRAFT_COLORS,
} from './draftAnalysis';

/**
 * Draft analysis is pure geometry math over typed arrays — exactly the kind
 * of code the rest of the suite tests (cf. channelPlacement.test). No WASM,
 * no React. We build tiny hand-written BufferGeometries so the expected
 * classification is obvious.
 */

function makeTriangle(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3),
  );
  return geo;
}

function bboxOf(geo: THREE.BufferGeometry): THREE.Box3 {
  geo.computeBoundingBox();
  return geo.boundingBox!.clone();
}

describe('classifyScore', () => {
  it('scores > 0.2 classify as green', () => {
    expect(classifyScore(1)).toBe('green');
    expect(classifyScore(0.5)).toBe('green');
    expect(classifyScore(0.21)).toBe('green');
  });

  it('scores in (0, 0.2] classify as yellow', () => {
    expect(classifyScore(0.2)).toBe('yellow');
    expect(classifyScore(0.1)).toBe('yellow');
    expect(classifyScore(0.01)).toBe('yellow');
  });

  it('scores ≤ 0 classify as red', () => {
    expect(classifyScore(0)).toBe('red');
    expect(classifyScore(-0.5)).toBe('red');
    expect(classifyScore(-1)).toBe('red');
  });
});

describe('buildDraftHeatmapGeometry', () => {
  it('paints an upward-facing triangle above the parting plane as green', () => {
    // Triangle at y=1 (above plane y=0), normal = +Y.
    // Right-hand rule: (B-A)×(C-A). With A=(0,1,0), B=(0,1,1), C=(1,1,0)
    // we get (0,0,1) × (1,0,0) = (0,1,0). Pull direction for "above plane"
    // is +Y → dot(+Y, +Y) = 1 → green.
    const tri = makeTriangle([0, 1, 0], [0, 1, 1], [1, 1, 0]);
    const bbox = new THREE.Box3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 1, 1));
    const colored = buildDraftHeatmapGeometry(tri, 'y', 0.5, bbox);
    const colors = colored.attributes.color.array as Float32Array;

    // All three vertices share the same face color.
    expect(colors[0]).toBeCloseTo(DRAFT_COLORS.green.r);
    expect(colors[1]).toBeCloseTo(DRAFT_COLORS.green.g);
    expect(colors[2]).toBeCloseTo(DRAFT_COLORS.green.b);
  });

  it('paints a downward-facing triangle above the parting plane as red (undercut)', () => {
    // Triangle at y=1 but normal = -Y (reversed winding vs. previous case).
    // Pull direction +Y · face normal -Y = -1 → red.
    const tri = makeTriangle([0, 1, 0], [1, 1, 0], [0, 1, 1]);
    const bbox = new THREE.Box3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 1, 1));
    const colored = buildDraftHeatmapGeometry(tri, 'y', 0.5, bbox);
    const colors = colored.attributes.color.array as Float32Array;

    expect(colors[0]).toBeCloseTo(DRAFT_COLORS.red.r);
    expect(colors[1]).toBeCloseTo(DRAFT_COLORS.red.g);
    expect(colors[2]).toBeCloseTo(DRAFT_COLORS.red.b);
  });

  it('paints a vertical side-wall triangle as red (zero draft classifies as undercut)', () => {
    // Triangle in the XY plane at z=0, normal = ±Z. Axis = Y → dot(normal, ±Y) = 0.
    // Zero dot → score = 0 → red. The seam-of-cylinder case is deliberately
    // red, not yellow, because a true vertical wall has no positive draft
    // and will bind against the mold during demold.
    const tri = makeTriangle([0, 1, 0], [1, 1, 0], [0, 2, 0]);
    const bbox = new THREE.Box3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 2, 1));
    const colored = buildDraftHeatmapGeometry(tri, 'y', 0.5, bbox);
    const colors = colored.attributes.color.array as Float32Array;
    expect(colors[0]).toBeCloseTo(DRAFT_COLORS.red.r);
  });

  it('produces a non-indexed geometry with per-face colors for an indexed input', () => {
    // Two triangles with disjoint vertex ranges — we only need to verify
    // that the output is structurally non-indexed with a color attribute,
    // not what the classifications resolve to. The classifications
    // themselves are covered by the preceding tests.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([
        0, 1, 0,  1, 1, 0,  0, 1, 1,
        0, -1, 0,  0, -1, 1,  1, -1, 0,
      ]), 3),
    );
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 3, 4, 5]), 1));

    const bbox = new THREE.Box3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 1, 1));
    const colored = buildDraftHeatmapGeometry(geo, 'y', 0.5, bbox);

    // After toNonIndexed, there should be 6 position entries (2 triangles × 3 verts)
    // with no index buffer, and 6 color entries matching.
    expect(colored.index).toBeNull();
    expect(colored.attributes.position.count).toBe(6);
    expect(colored.attributes.color.count).toBe(6);
  });

  it('does not mutate the source geometry', () => {
    const tri = makeTriangle([0, 1, 0], [1, 1, 0], [0, 1, 1]);
    const bbox = bboxOf(tri);
    const originalPositions = Array.from(tri.attributes.position.array);

    buildDraftHeatmapGeometry(tri, 'y', 0.5, bbox);

    expect(Array.from(tri.attributes.position.array)).toEqual(originalPositions);
    expect(tri.attributes.color).toBeUndefined();
  });
});

describe('summarizeClassification', () => {
  it('counts classifications across a tiny 2-triangle model', () => {
    // Cube top (green) + cube floor pointing down (red from top-half perspective).
    // We'll put both triangles in the top half so only the pull direction
    // matters, not which side of the plane they're on.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([
        // Upward triangle at y=1 (normal +Y via CCW winding) → green
        0, 1, 0,  0, 1, 1,  1, 1, 0,
        // Downward triangle at y=1 (normal -Y, reversed winding) → red (undercut)
        0, 1, 0,  1, 1, 0,  0, 1, 1,
      ]), 3),
    );

    const bbox = new THREE.Box3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 1, 1));
    const summary = summarizeClassification(geo, 'y', 0.5, bbox);

    expect(summary.total).toBe(2);
    expect(summary.green).toBe(1);
    expect(summary.red).toBe(1);
    expect(summary.yellow).toBe(0);
  });
});
