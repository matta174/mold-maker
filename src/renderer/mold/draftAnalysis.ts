import * as THREE from 'three';
import type { Axis } from '../types';

/**
 * Demoldability heatmap — classifies every triangle of the input model by
 * how demoldable it is given the currently selected parting plane. This is
 * the "weather radar" view: it lets users see, before they run the CSG,
 * where a cut will and won't work.
 *
 * Classification is per-face (not per-vertex) because face normals are what
 * physically matter during demold — smoothed vertex normals would paint a
 * sharp ridge between a flat draftable face and a vertical undercut as
 * "yellow" when really it's one of each. Per-face means we convert indexed
 * geometry to non-indexed (one vertex triple per triangle) and set a
 * constant color on each triangle.
 *
 * Classification rule:
 *   score = dot(faceNormal, pullDirection)
 *
 *   pullDirection flips across the parting plane: for a face above the
 *   plane the mold half that contains it pulls in +axis; below the plane
 *   pulls in -axis. That means `pullDirection = sign(centroid[axis] - plane) * axisUnit`.
 *
 *     score >  DRAFT_OK         → GREEN  (positive draft, easy demold)
 *     DRAFT_UNDERCUT < score    → YELLOW (marginal — near-vertical wall)
 *     score ≤ DRAFT_UNDERCUT    → RED    (undercut — face points away from
 *                                         the puller, will catch on the mold)
 */

/** Score above which a face is unambiguously draftable. */
export const DRAFT_OK_THRESHOLD = 0.2;
/** Score at/below which a face is considered undercut. */
export const DRAFT_UNDERCUT_THRESHOLD = 0.0;

export const DRAFT_COLORS = {
  // Tailwind-adjacent hues chosen for high contrast against the viewport bg
  // and for colorblind-reasonable separation (greens vs reds aren't perfect
  // for deutan/protan — we deliberately use a warmer yellow rather than
  // orange to keep the yellow→red transition visible).
  green: new THREE.Color('#4ade80'),
  yellow: new THREE.Color('#facc15'),
  red: new THREE.Color('#ef4444'),
} as const;

export type DraftClass = 'green' | 'yellow' | 'red';

/** Axis index lookup: 'x' → 0, 'y' → 1, 'z' → 2. */
function axisIndex(axis: Axis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

/** Classify a single dot-product score into one of three buckets. */
export function classifyScore(score: number): DraftClass {
  if (score > DRAFT_OK_THRESHOLD) return 'green';
  if (score > DRAFT_UNDERCUT_THRESHOLD) return 'yellow';
  return 'red';
}

/**
 * Build a non-indexed BufferGeometry with per-face colors encoding the
 * demoldability classification.
 *
 * @param source    Source geometry (indexed or non-indexed). NOT mutated.
 * @param axis      Pull axis for the parting plane.
 * @param offset    Parting plane position, [0,1] along the axis within bbox.
 * @param bbox      Bounding box of the source geometry (reused from AppState).
 *
 * The returned geometry is suitable for a mesh with MeshBasicMaterial
 * and `vertexColors: true`. Caller owns disposal.
 */
export function buildDraftHeatmapGeometry(
  source: THREE.BufferGeometry,
  axis: Axis,
  offset: number,
  bbox: THREE.Box3,
): THREE.BufferGeometry {
  // Work against a non-indexed copy so we can assign independent colors to
  // triangles that share vertices in the original index buffer.
  const nonIndexed = source.index ? source.toNonIndexed() : source.clone();

  const posAttr = nonIndexed.attributes.position;
  if (!posAttr) {
    throw new Error('Source geometry has no position attribute.');
  }
  const positions = posAttr.array as Float32Array;
  const triCount = positions.length / 9; // 3 vertices * 3 components per triangle

  const ai = axisIndex(axis);
  const planeWorld = bbox.min.getComponent(ai)
    + (bbox.max.getComponent(ai) - bbox.min.getComponent(ai)) * offset;

  const colors = new Float32Array(triCount * 9);

  // Scratch vectors reused across the loop — each `new Vector3()` would
  // allocate on the hot path for models with hundreds of thousands of faces.
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 9;

    a.set(positions[i0 + 0], positions[i0 + 1], positions[i0 + 2]);
    b.set(positions[i0 + 3], positions[i0 + 4], positions[i0 + 5]);
    c.set(positions[i0 + 6], positions[i0 + 7], positions[i0 + 8]);

    // Face normal via right-hand rule: (B-A) × (C-A), normalized.
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len > 0) n.divideScalar(len);

    // Centroid axis coordinate — no need to build the full Vector3, we only
    // need the one component to pick which side of the parting plane we're on.
    const centroidOnAxis =
      (positions[i0 + ai] + positions[i0 + 3 + ai] + positions[i0 + 6 + ai]) / 3;

    // Pull direction: +1 if centroid is above the plane (this face lives in
    // the "top" half, which gets pulled in +axis), -1 if below.
    // At exactly plane-world the sign is 0 and the dot product collapses to
    // 0 → classified as red, which is a reasonable "you're on the seam"
    // signal (splits right on an edge are always marginal).
    const sign =
      centroidOnAxis > planeWorld ? 1
        : centroidOnAxis < planeWorld ? -1
          : 0;
    const score = sign * n.getComponent(ai);

    const cls = classifyScore(score);
    const col = DRAFT_COLORS[cls];

    // Write the same color to all 3 vertices of this triangle.
    for (let v = 0; v < 3; v++) {
      const ci = i0 + v * 3;
      colors[ci + 0] = col.r;
      colors[ci + 1] = col.g;
      colors[ci + 2] = col.b;
    }
  }

  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Normals — ensure they exist for any downstream consumer that expects them.
  // Cheap (linear in triangle count) and makes the geometry self-contained.
  if (!nonIndexed.attributes.normal) {
    nonIndexed.computeVertexNormals();
  }
  return nonIndexed;
}

/**
 * Summary counts — handy for telemetry, tests, or a future "12% undercut"
 * status line. Pure over the geometry; no side effects.
 */
export function summarizeClassification(
  source: THREE.BufferGeometry,
  axis: Axis,
  offset: number,
  bbox: THREE.Box3,
): { green: number; yellow: number; red: number; total: number } {
  const nonIndexed = source.index ? source.toNonIndexed() : source;
  const positions = nonIndexed.attributes.position.array as Float32Array;
  const triCount = positions.length / 9;

  const ai = axisIndex(axis);
  const planeWorld = bbox.min.getComponent(ai)
    + (bbox.max.getComponent(ai) - bbox.min.getComponent(ai)) * offset;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();

  let green = 0, yellow = 0, red = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 9;
    a.set(positions[i0 + 0], positions[i0 + 1], positions[i0 + 2]);
    b.set(positions[i0 + 3], positions[i0 + 4], positions[i0 + 5]);
    c.set(positions[i0 + 6], positions[i0 + 7], positions[i0 + 8]);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const len = n.length();
    if (len > 0) n.divideScalar(len);

    const centroidOnAxis =
      (positions[i0 + ai] + positions[i0 + 3 + ai] + positions[i0 + 6 + ai]) / 3;
    const sign = centroidOnAxis > planeWorld ? 1 : centroidOnAxis < planeWorld ? -1 : 0;
    const score = sign * n.getComponent(ai);
    const cls = classifyScore(score);

    if (cls === 'green') green++;
    else if (cls === 'yellow') yellow++;
    else red++;
  }

  // Dispose the intermediate if we made a copy (source was indexed) —
  // otherwise we'd leak one BufferGeometry per call.
  if (source.index) nonIndexed.dispose();

  return { green, yellow, red, total: triCount };
}
