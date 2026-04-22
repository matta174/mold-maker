import * as THREE from 'three';
import type { Axis } from '../types';
import { planeFromBox, type PlaneEquation } from './planeGeometry';

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
 *   pullDirection flips across the parting plane: for a face on the
 *   positive side of the plane the mold half pulls along +planeNormal;
 *   below it pulls along -planeNormal.
 *
 *     score >  DRAFT_OK         → GREEN  (positive draft, easy demold)
 *     DRAFT_UNDERCUT < score    → YELLOW (marginal — near-vertical wall)
 *     score ≤ DRAFT_UNDERCUT    → RED    (undercut — face points away from
 *                                         the puller, will catch on the mold)
 *
 * For axis-aligned cuts (cutAngle=0) this degenerates to the old
 * dot(faceNormal, axisUnitVector) formulation — the plane equation's
 * normal IS the axis unit vector in that case, by construction.
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

/** Classify a single dot-product score into one of three buckets. */
export function classifyScore(score: number): DraftClass {
  if (score > DRAFT_OK_THRESHOLD) return 'green';
  if (score > DRAFT_UNDERCUT_THRESHOLD) return 'yellow';
  return 'red';
}

/**
 * Cache of non-indexed positions keyed on the source geometry. The heatmap
 * rebuilds on every slider tick (axis/offset/cutAngle), but the SOURCE mesh
 * changes only when the user loads a file. Without this cache, every tick
 * allocates a fresh ~1.8 MB Float32Array for a 50k-tri indexed mesh —
 * gratuitous GC pressure while dragging.
 *
 * WeakMap lets the cached array get GC'd automatically when the source
 * geometry is disposed, so there's no manual invalidation needed. For
 * geometries that are already non-indexed we just return their own array
 * without caching (nothing to save).
 */
const nonIndexedPositionsCache = new WeakMap<THREE.BufferGeometry, Float32Array>();

function getNonIndexedPositions(source: THREE.BufferGeometry): Float32Array {
  if (!source.index) {
    // Non-indexed already — caller can use the buffer directly. Don't cache;
    // the array is already owned by `source` and will be freed with it.
    return source.attributes.position.array as Float32Array;
  }
  const cached = nonIndexedPositionsCache.get(source);
  if (cached) return cached;

  const expanded = source.toNonIndexed();
  const positions = expanded.attributes.position.array as Float32Array;
  nonIndexedPositionsCache.set(source, positions);
  // The intermediate geometry wrapper is no longer needed — we only wanted
  // the positions. Dropping the reference lets GC collect the wrapper's
  // other attributes (colors, normals) which we'd otherwise hold onto.
  return positions;
}

/**
 * Core per-triangle classification, shared by the heatmap and summary paths.
 *
 * For each triangle:
 *   1. compute face normal via right-hand rule
 *   2. compute triangle centroid
 *   3. signed distance from centroid to the plane determines which half
 *      the triangle lives in (+1 = normal side, -1 = opposite, 0 = on plane)
 *   4. score = sign * dot(faceNormal, planeNormal)
 *
 * Splits right on the parting seam (sign=0) collapse to score=0 → red.
 * That's a reasonable "you're on the seam" signal: a triangle bisected by
 * the cut is always marginal, whether the plane is axis-aligned or tilted.
 */
function iterateClassifications(
  positions: Float32Array,
  plane: PlaneEquation,
  visit: (cls: DraftClass) => void,
): void {
  const triCount = positions.length / 9;

  // Scratch vectors reused across the loop — each `new Vector3()` would
  // allocate on the hot path for models with hundreds of thousands of faces.
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();

  const planeNx = plane.normal[0];
  const planeNy = plane.normal[1];
  const planeNz = plane.normal[2];

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

    // Centroid → signed distance to plane. Inlined for perf (no Vector3 alloc).
    const cx = (positions[i0 + 0] + positions[i0 + 3] + positions[i0 + 6]) / 3;
    const cy = (positions[i0 + 1] + positions[i0 + 4] + positions[i0 + 7]) / 3;
    const cz = (positions[i0 + 2] + positions[i0 + 5] + positions[i0 + 8]) / 3;
    const signedDist =
      cx * planeNx + cy * planeNy + cz * planeNz - plane.originOffset;

    const sign = signedDist > 0 ? 1 : signedDist < 0 ? -1 : 0;

    // Face-normal · plane-normal (inlined dot product).
    const faceDotPlane = n.x * planeNx + n.y * planeNy + n.z * planeNz;
    const score = sign * faceDotPlane;

    visit(classifyScore(score));
  }
}

/**
 * Build a non-indexed BufferGeometry with per-face colors encoding the
 * demoldability classification.
 *
 * @param source    Source geometry (indexed or non-indexed). NOT mutated.
 * @param axis      Pull axis for the parting plane.
 * @param offset    Parting plane position, [0,1] along the axis within bbox.
 * @param bbox      Bounding box of the source geometry (reused from AppState).
 * @param cutAngle  Tilt angle around the hinge axis in degrees. Defaults to 0.
 *
 * The returned geometry is suitable for a mesh with MeshBasicMaterial
 * and `vertexColors: true`. Caller owns disposal.
 */
export function buildDraftHeatmapGeometry(
  source: THREE.BufferGeometry,
  axis: Axis,
  offset: number,
  bbox: THREE.Box3,
  cutAngle = 0,
): THREE.BufferGeometry {
  if (!source.attributes.position) {
    throw new Error('Source geometry has no position attribute.');
  }

  // Reuse the expanded-positions buffer across slider ticks — see the
  // comment on `nonIndexedPositionsCache`. The returned geometry is a fresh
  // wrapper so the caller can `.dispose()` it without affecting the cache.
  const positions = getNonIndexedPositions(source);
  const triCount = positions.length / 9; // 3 vertices * 3 components per triangle

  const plane = planeFromBox(bbox, axis, offset, cutAngle);
  const colors = new Float32Array(triCount * 9);

  let t = 0;
  iterateClassifications(positions, plane, (cls) => {
    const col = DRAFT_COLORS[cls];
    const i0 = t * 9;
    // Write the same color to all 3 vertices of this triangle.
    for (let v = 0; v < 3; v++) {
      const ci = i0 + v * 3;
      colors[ci + 0] = col.r;
      colors[ci + 1] = col.g;
      colors[ci + 2] = col.b;
    }
    t++;
  });

  const out = new THREE.BufferGeometry();
  // Point at the cached positions buffer rather than cloning it — dispose()
  // on the returned geometry only releases the GPU resources; the JS
  // Float32Array stays owned by the WeakMap entry.
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Normals — ensure they exist for any downstream consumer that expects them.
  // Cheap (linear in triangle count) and makes the geometry self-contained.
  out.computeVertexNormals();
  return out;
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
  cutAngle = 0,
): { green: number; yellow: number; red: number; total: number } {
  // Shares the expanded-positions cache with buildDraftHeatmapGeometry —
  // no per-call BufferGeometry allocation and no manual dispose needed.
  const positions = getNonIndexedPositions(source);
  const triCount = positions.length / 9;

  const plane = planeFromBox(bbox, axis, offset, cutAngle);

  let green = 0, yellow = 0, red = 0;
  iterateClassifications(positions, plane, (cls) => {
    if (cls === 'green') green++;
    else if (cls === 'yellow') yellow++;
    else red++;
  });

  return { green, yellow, red, total: triCount };
}
