import * as THREE from 'three';
import type { Axis } from '../types';
import {
  PIN_INSET_RATIO,
  VENT_CANDIDATE_SAMPLE_CAP,
  VENT_MIN_SPACING_RATIO,
  MAX_VENTS,
  MIN_VENTS,
  dbg,
} from './constants';
import type { MoldEnvelope } from './moldBox';
import { lateralAxisIndices, primaryAxisIndex } from './moldBox';

// ─────────────────────────────────────────────────────────────────────────────
// Shape-aware cross-section math
// ─────────────────────────────────────────────────────────────────────────────
//
// Channels (sprue + vents) are cylindrical holes drilled along the parting
// axis. Each one needs to sit inside the mold cross-section with enough
// material around it to avoid breaching the outer wall — otherwise the CSG
// subtract cuts a slot through the side of the shell (visually: "pour hole
// drilled through the side") or yields a degenerate mesh ("regenerate nukes
// the mold").
//
// `clampToMoldInterior` takes a desired (latA, latB) point and pulls it
// inward to the nearest safe location for a channel of the given radius.
// Shape-specific:
//   - rect / roundedRect: AABB inset by max(margin, cornerRadius).
//   - cylinder: circle of radius (cylinderRadius - margin).

export function clampToMoldInterior(
  latA: number,
  latB: number,
  env: MoldEnvelope,
  margin: number,
): [number, number] {
  const [latAIdx, latBIdx] = lateralAxisIndices(env.axis);

  if (env.shape === 'cylinder') {
    const cA = env.cylinderCenterLatA ?? 0;
    const cB = env.cylinderCenterLatB ?? 0;
    const r = env.cylinderRadius ?? 0;
    const maxDist = Math.max(0, r - margin);
    const dA = latA - cA;
    const dB = latB - cB;
    const dist = Math.sqrt(dA * dA + dB * dB);
    if (dist <= maxDist || dist < 1e-9) return [latA, latB];
    const scale = maxDist / dist;
    return [cA + dA * scale, cB + dB * scale];
  }

  // rect / roundedRect: clamp to AABB. For roundedRect, inflate the margin by
  // cornerRadius so clamped points never land in the corner-cutout region.
  const effMargin =
    env.shape === 'roundedRect'
      ? Math.max(margin, env.cornerRadius ?? 0)
      : margin;

  const minA = env.moldMin.getComponent(latAIdx) + effMargin;
  const maxA = env.moldMin.getComponent(latAIdx) + env.moldSize.getComponent(latAIdx) - effMargin;
  const minB = env.moldMin.getComponent(latBIdx) + effMargin;
  const maxB = env.moldMin.getComponent(latBIdx) + env.moldSize.getComponent(latBIdx) - effMargin;

  // Handle degenerate cases where margin exceeds half the box: collapse to
  // the axis-center. Caller generally shouldn't hit this — it means the
  // channel is too big for the mold — but we'd rather return a sensible
  // centered point than NaN or an inverted range.
  const clampedA = maxA >= minA ? Math.min(Math.max(latA, minA), maxA)
    : (env.moldMin.getComponent(latAIdx) + env.moldSize.getComponent(latAIdx) / 2);
  const clampedB = maxB >= minB ? Math.min(Math.max(latB, minB), maxB)
    : (env.moldMin.getComponent(latBIdx) + env.moldSize.getComponent(latBIdx) / 2);
  return [clampedA, clampedB];
}

/**
 * Shape-aware fallback seed points for vents, used when part-geometry
 * extremities yield fewer than MIN_VENTS candidates (e.g. a simple sphere).
 *
 * - rect / roundedRect: the four bbox corners clamped to the mold interior
 *   — matches the legacy behaviour.
 * - cylinder: four cardinal points on the inscribed square (±r/√2 from the
 *   cylinder axis), so fallback vents stay inside the circular cross-section.
 *   The old code placed them at bbox corners, which often sit outside the
 *   cylinder's radius, producing degenerate CSG.
 */
export function fallbackVentSeeds(
  env: MoldEnvelope,
  bbox: THREE.Box3,
  margin: number,
): [number, number][] {
  const [latAIdx, latBIdx] = lateralAxisIndices(env.axis);

  if (env.shape === 'cylinder') {
    const cA = env.cylinderCenterLatA ?? 0;
    const cB = env.cylinderCenterLatB ?? 0;
    const r = Math.max(0, (env.cylinderRadius ?? 0) - margin);
    // Four cardinals on the inscribed square. A point at (r·√½, r·√½) sits
    // EXACTLY on the safe circle of radius r, so float rounding can push it
    // a hair outside. Shave an extra 1% off so the seeds land strictly
    // inside the safe region — equivalent to clamping with a slightly
    // larger margin, cheaper than a second clamp pass.
    const d = r * Math.SQRT1_2 * 0.99;
    return [
      [cA + d, cB + d],
      [cA - d, cB + d],
      [cA - d, cB - d],
      [cA + d, cB - d],
    ];
  }

  // rect / roundedRect: bbox corners, then clamped to mold interior so a
  // very thin bbox inside a large mold doesn't produce wall-piercing vents.
  const raw: [number, number][] = [
    [bbox.min.getComponent(latAIdx), bbox.min.getComponent(latBIdx)],
    [bbox.max.getComponent(latAIdx), bbox.max.getComponent(latBIdx)],
    [bbox.min.getComponent(latAIdx), bbox.max.getComponent(latBIdx)],
    [bbox.max.getComponent(latAIdx), bbox.min.getComponent(latBIdx)],
  ];
  return raw.map(([a, b]) => clampToMoldInterior(a, b, env, margin));
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration pin and sprue/vent placement
// ─────────────────────────────────────────────────────────────────────────────
//
// These functions decide WHERE things go on a mold. They're pure
// (geometry + parameters → positions), so they can be tested without running
// any CSG or loading any WASM.

export function getRegistrationPinPositions(
  bbox: THREE.Box3,
  axis: Axis,
  splitPos: number,
  wallThickness: number,
): [number, number, number][] {
  const inset = wallThickness * PIN_INSET_RATIO;
  const positions: [number, number, number][] = [];

  switch (axis) {
    case 'z':
      positions.push(
        [bbox.min.x - inset, bbox.min.y - inset, splitPos],
        [bbox.max.x + inset, bbox.min.y - inset, splitPos],
        [bbox.min.x - inset, bbox.max.y + inset, splitPos],
        [bbox.max.x + inset, bbox.max.y + inset, splitPos],
      );
      break;
    case 'y':
      positions.push(
        [bbox.min.x - inset, splitPos, bbox.min.z - inset],
        [bbox.max.x + inset, splitPos, bbox.min.z - inset],
        [bbox.min.x - inset, splitPos, bbox.max.z + inset],
        [bbox.max.x + inset, splitPos, bbox.max.z + inset],
      );
      break;
    case 'x':
      positions.push(
        [splitPos, bbox.min.y - inset, bbox.min.z - inset],
        [splitPos, bbox.max.y + inset, bbox.min.z - inset],
        [splitPos, bbox.min.y - inset, bbox.max.z + inset],
        [splitPos, bbox.max.y + inset, bbox.max.z + inset],
      );
      break;
  }

  return positions;
}

/**
 * Shape-aware registration pin placement.
 *
 * - `rect` / `roundedRect`: delegates to the legacy AABB-corner logic. The cap
 *   in `pickCornerRadius` guarantees pin bodies clear the rounded cutout for
 *   `roundedRect`.
 * - `cylinder`: places 4 pins at cardinal directions (0/90/180/270°) on the
 *   parting plane, at a radial distance matching the bbox-corner case so pins
 *   still sit in the wall material between cavity and shell.
 *
 * Kept as a separate function (rather than overloading `getRegistrationPinPositions`)
 * so existing callers and tests keep working unchanged.
 */
export function getRegistrationPinPositionsForEnvelope(
  env: MoldEnvelope,
  bbox: THREE.Box3,
  splitPos: number,
): [number, number, number][] {
  if (env.shape !== 'cylinder') {
    return getRegistrationPinPositions(bbox, env.axis, splitPos, env.wallThickness);
  }

  // Cylinder: radial pins on the parting plane.
  const primary = primaryAxisIndex(env.axis);
  const [latA, latB] = lateralAxisIndices(env.axis);
  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);
  const halfLatA = bboxSize.getComponent(latA) / 2;
  const halfLatB = bboxSize.getComponent(latB) / 2;

  // Radial distance: mid-wall between the part's bounding circle and the
  // outer cylinder wall. Matches the rect case's "pin sits in the wall, inset
  // from the outer face by (1 - PIN_INSET_RATIO) * wallThickness".
  const partCircleRadius = Math.sqrt(halfLatA * halfLatA + halfLatB * halfLatB);
  const pinRadialDist = partCircleRadius + env.wallThickness * (1 - PIN_INSET_RATIO);

  const centerA = env.cylinderCenterLatA ?? 0;
  const centerB = env.cylinderCenterLatB ?? 0;

  const positions: [number, number, number][] = [];
  for (const [da, db] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const pos: [number, number, number] = [0, 0, 0];
    pos[primary] = splitPos;
    pos[latA] = centerA + da * pinRadialDist;
    pos[latB] = centerB + db * pinRadialDist;
    positions.push(pos);
  }
  return positions;
}

/**
 * Rotation (in DEGREES) to orient a default-Z cylinder along the given axis.
 *
 * Manifold rotates in global X-Y-Z order with the right-hand rule (see
 * manifold-3d/manifold-encapsulated-types.d.ts `rotate` docs). Tracing the
 * local +Z unit vector through each case:
 *   - `[0, 90, 0]`  → +X  (used for axis='x', correct)
 *   - `[-90, 0, 0]` → +Y  (used for axis='y' — NOTE: historically [90,0,0]
 *                         was used here, which sends +Z → −Y, silently
 *                         placing the shell/pins/sprue in the wrong half-
 *                         space. Only Z was well-exercised so this never
 *                         surfaced in screenshots, but roundedRect and
 *                         cylinder molds split along Y were effectively
 *                         broken before this fix.)
 *   - `[0, 0, 0]`   → +Z  (no-op, used for axis='z')
 */
export function getRotationForAxis(axis: Axis): [number, number, number] {
  switch (axis) {
    case 'x': return [0, 90, 0];
    case 'y': return [-90, 0, 0];
    case 'z': return [0, 0, 0];
  }
}

/**
 * Compute sprue and vent positions using geometry analysis.
 *
 * Strategy (follows standard mold-design practice — see references in
 * generateMold.ts):
 * - SPRUE: centroid of part vertices in the "top" half (positive side of
 *   split) — heuristic for the thickest cross-section. Gating into the
 *   thickest section lets material flow thick→thin and keeps packing
 *   pressure on the bulk, reducing shrinkage voids. The centroid is then
 *   *clamped to the mold interior* so the sprue cylinder never breaches
 *   the outer shell wall.
 *
 * - VENTS: extremity vertices in the top half that are farthest from the
 *   sprue — where air gets trapped last. Clustered for spacing, clamped
 *   to the mold interior, with shape-aware fallbacks if clustering yields
 *   fewer than MIN_VENTS.
 *
 * Manifold.cylinder() creates along Z by default, so we return a rotation
 * (in degrees) to orient the holes along the correct axis.
 *
 * The legacy signature (bbox/axis/moldMin/moldSize) is preserved so
 * existing callers and tests keep working; it builds a throwaway rect
 * envelope internally. New callers should prefer
 * `computeChannelPositionsForEnvelope`, which is shape-aware (needed for
 * cylinder / roundedRect outer shells).
 */
export function computeChannelPositions(
  bbox: THREE.Box3,
  axis: Axis,
  splitPos: number,
  moldMin: THREE.Vector3,
  moldSize: THREE.Vector3,
  geometry: THREE.BufferGeometry,
): {
  spruePos: [number, number, number];
  sprueHeight: number;
  ventPositions: [number, number, number][];
  rotation: [number, number, number];
} {
  // Synthesize a rect envelope with the given AABB. This preserves the
  // pre-shape-awareness behaviour bit-for-bit for callers that haven't
  // migrated to `computeChannelPositionsForEnvelope`.
  const env: MoldEnvelope = {
    shape: 'rect',
    axis,
    wallThickness: 0,
    moldMin: moldMin.clone(),
    moldSize: moldSize.clone(),
  };
  return computeChannelPositionsForEnvelope(env, bbox, splitPos, geometry, {
    sprueMargin: 0,
    ventMargin: 0,
  });
}

/**
 * Shape-aware variant of computeChannelPositions.
 *
 * Takes a `MoldEnvelope` (which knows whether the outer shell is rect,
 * roundedRect, or cylinder) plus clearance margins for the sprue and vent
 * holes. Channel lateral positions are clamped to stay inside the mold
 * cross-section with at least `margin` of material between each hole's
 * outer radius and the shell's outer wall.
 *
 * Margins should be passed as `holeRadius + safetyWall`, where safetyWall
 * is a fraction of wallThickness (callers in generateMold.ts use 0.5× for
 * the sprue and 0.3× for vents — aggressive enough to avoid visible
 * breakouts on curved cylinders, mild enough to keep channels near the
 * part's actual extremities on boxy parts).
 */
export function computeChannelPositionsForEnvelope(
  env: MoldEnvelope,
  bbox: THREE.Box3,
  splitPos: number,
  geometry: THREE.BufferGeometry,
  margins: { sprueMargin: number; ventMargin: number },
): {
  spruePos: [number, number, number];
  sprueHeight: number;
  ventPositions: [number, number, number][];
  rotation: [number, number, number];
} {
  const axis = env.axis;
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);

  const axisIdx = primaryAxisIndex(axis);
  const [lateralA, lateralB] = lateralAxisIndices(axis);
  const topFaceVal = env.moldMin.getComponent(axisIdx) + env.moldSize.getComponent(axisIdx);
  const sprueHeight = topFaceVal - splitPos;

  const positions = geometry.attributes.position.array;
  const vertCount = positions.length / 3;

  // ── Find optimal sprue position ──
  // Practical heuristic: centroid of all vertices in the top half. This
  // naturally gravitates toward the bulk of the part (≈ thickest section).
  let sumA = 0, sumB = 0, topCount = 0;

  for (let i = 0; i < vertCount; i++) {
    const splitVal = positions[i * 3 + axisIdx];
    if (splitVal >= splitPos) {
      sumA += positions[i * 3 + lateralA];
      sumB += positions[i * 3 + lateralB];
      topCount++;
    }
  }

  const rawCentroidA = topCount > 0 ? sumA / topCount : center.getComponent(lateralA);
  const rawCentroidB = topCount > 0 ? sumB / topCount : center.getComponent(lateralB);

  // Clamp the sprue lateral position so the pour hole never breaks through
  // the shell's outer wall — the core fix for cylinder and roundedRect molds.
  const [centroidA, centroidB] = clampToMoldInterior(
    rawCentroidA, rawCentroidB, env, margins.sprueMargin,
  );

  const spruePos: [number, number, number] = [0, 0, 0];
  spruePos[axisIdx] = splitPos;
  spruePos[lateralA] = centroidA;
  spruePos[lateralB] = centroidB;

  // ── Find optimal vent positions ──
  // Sample every Nth vertex to cap the candidate array size.
  const sampleStep = Math.max(1, Math.floor(vertCount / VENT_CANDIDATE_SAMPLE_CAP));
  const ventCandidates: { dist: number; a: number; b: number }[] = [];

  for (let i = 0; i < vertCount; i += sampleStep) {
    const splitVal = positions[i * 3 + axisIdx];
    if (splitVal >= splitPos) {
      const a = positions[i * 3 + lateralA];
      const b = positions[i * 3 + lateralB];
      // Distance relative to the (pre-clamp) part-centroid — picks vertices
      // far from the geometric bulk, where air traps actually form. Clamping
      // happens only at the final placement step below.
      const dist = Math.sqrt((a - rawCentroidA) ** 2 + (b - rawCentroidB) ** 2);
      ventCandidates.push({ dist, a, b });
    }
  }

  ventCandidates.sort((x, y) => y.dist - x.dist);

  // Cluster the farthest points into distinct vent locations
  const ventPositions: [number, number, number][] = [];
  const minVentSpacing = Math.max(bboxSize.getComponent(lateralA), bboxSize.getComponent(lateralB)) * VENT_MIN_SPACING_RATIO;

  for (const candidate of ventCandidates) {
    if (ventPositions.length >= MAX_VENTS) break;

    const [ca, cb] = clampToMoldInterior(candidate.a, candidate.b, env, margins.ventMargin);

    const tooClose = ventPositions.some(vp => {
      const da = vp[lateralA] - ca;
      const db = vp[lateralB] - cb;
      return Math.sqrt(da * da + db * db) < minVentSpacing;
    });

    if (!tooClose) {
      const pos: [number, number, number] = [0, 0, 0];
      pos[axisIdx] = splitPos;
      pos[lateralA] = ca;
      pos[lateralB] = cb;
      ventPositions.push(pos);
    }
  }

  // Ensure at least MIN_VENTS vents: if clustering eliminated too many, use
  // shape-aware fallback seeds. Bbox corners would sit outside a cylinder's
  // radius and pierce the shell wall — `fallbackVentSeeds` returns points
  // already inside each shape's cross-section.
  if (ventPositions.length < MIN_VENTS) {
    for (const [ca, cb] of fallbackVentSeeds(env, bbox, margins.ventMargin)) {
      if (ventPositions.length >= MIN_VENTS) break;
      const pos: [number, number, number] = [0, 0, 0];
      pos[axisIdx] = splitPos;
      pos[lateralA] = ca;
      pos[lateralB] = cb;
      ventPositions.push(pos);
    }
  }

  // Rotation to orient cylinders along the split axis (DEGREES — manifold-3d convention)
  const rotation = getRotationForAxis(axis);

  dbg(`Sprue at [${spruePos.map(v => v.toFixed(1))}], ${ventPositions.length} vents, height ${sprueHeight.toFixed(1)}`);

  return { spruePos, sprueHeight, ventPositions, rotation };
}
