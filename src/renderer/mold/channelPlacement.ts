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
import {
  planeFromBox,
  primaryAxisValueOnPlane,
  signedDistance,
  type PlaneEquation,
  type Vec3,
} from './planeGeometry';

// ─────────────────────────────────────────────────────────────────────────────
// Registration pin and sprue/vent placement
// ─────────────────────────────────────────────────────────────────────────────
//
// These functions decide WHERE things go on a mold. They're pure
// (geometry + parameters → positions), so they can be tested without running
// any CSG or loading any WASM.
//
// Parting-plane handling:
//   • Axis-aligned cuts (cutAngle = 0): the classic `splitPos` scalar along a
//     single axis. Code paths tagged "fast path" below stay bit-identical.
//   • Oblique cuts (cutAngle ≠ 0): represented as a full PlaneEquation so that
//     "which half?" checks use signed distance and features (pins, sprue,
//     vents) sit *on* the tilted plane — not at a now-meaningless splitPos.
//
// Cylinder orientation remains axis-aligned even under tilt: within the ±30°
// cap the pin / sprue / vent axes deviate from the plane normal by less than
// 30°, which keeps them in the correct half after the CSG split without
// forcing a full per-channel Euler-angle computation. If the cap is ever
// widened this should be revisited.

/**
 * Reconstruct the normalized offset (0..1 inside the bbox along the axis)
 * from an absolute splitPos — needed because channel callers hand us an
 * absolute coord but getPlaneEquation expects the normalised 0..1 form.
 */
function offsetFromSplitPos(
  bbox: THREE.Box3, axis: Axis, splitPos: number,
): number {
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const minC = bbox.min.getComponent(axisIdx);
  const maxC = bbox.max.getComponent(axisIdx);
  const range = maxC - minC;
  if (range <= 0) return 0;
  return (splitPos - minC) / range;
}

/**
 * Return a PlaneEquation only when the cut is actually tilted. At cutAngle=0
 * every caller uses the legacy scalar splitPos, so building a plane would be
 * both wasted work and a behaviour divergence (the signed-distance path isn't
 * bit-identical to the old coord comparison for points sitting exactly on the
 * seam). `null` means "fast path — use splitPos". Centralising the check
 * stops the three-line pattern from drifting between call sites.
 */
function planeIfTilted(
  bbox: THREE.Box3, axis: Axis, splitPos: number, cutAngle: number,
): PlaneEquation | null {
  if (cutAngle === 0) return null;
  return planeFromBox(bbox, axis, offsetFromSplitPos(bbox, axis, splitPos), cutAngle);
}

/**
 * Lift (lateralA, lateralB) onto the parting plane by solving for the primary
 * axis coord. For axis-aligned cuts this is just the input `splitPos`; for
 * tilted cuts it's the intersection of the axis-parallel line through the
 * lateral point with the plane.
 */
function liftToPlane(
  plane: PlaneEquation | null,
  axis: Axis,
  splitPos: number,
  lateralPoint: Vec3,
): number {
  if (!plane) return splitPos; // fast path
  return primaryAxisValueOnPlane(plane, axis, lateralPoint);
}

/**
 * 2D point-in-triangle using barycentric coordinates. Returns true when (px,py)
 * lies on or inside the triangle (a, b, c). Degenerate (zero-area) triangles
 * return false.
 */
function pointInTriangle2D(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  const v0x = cx - ax, v0y = cy - ay;
  const v1x = bx - ax, v1y = by - ay;
  const v2x = px - ax, v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (denom === 0) return false; // degenerate
  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

/**
 * Verify that a lateral point (a, b) is "over" the cavity — i.e., there exists
 * at least one top-half triangle whose lateral projection contains (a, b).
 *
 * Motivation: the area-weighted surface centroid is a good proxy for "bulk of
 * the part" but lies in the HOLE for parts with a concavity passing through
 * the centroid — think of a donut. If the sprue lands in the hole, the
 * sprue-cylinder subtraction carves air through solid mold material and never
 * reaches the cavity; there's no pour path at all.
 *
 * When the point fails the inside test, we snap to the nearest top-half
 * triangle centroid on the lateral plane. That centroid is by construction
 * on the part's surface, so the sprue cylinder will meet real material.
 *
 * Complexity: O(triangles). Fine for meshes under ~100K triangles — a single
 * pass through the buffer runs in a millisecond or two.
 */
function verifyLateralOverCavity(
  sprueA: number, sprueB: number,
  positions: ArrayLike<number>,
  index: THREE.BufferAttribute | null,
  lateralA: number, lateralB: number,
  isTopHalf: (x: number, y: number, z: number) => boolean,
): { inside: boolean; snapA: number; snapB: number } {
  const triCount = index ? index.count / 3 : positions.length / 9;
  let nearestD2 = Infinity;
  let nearestA = sprueA;
  let nearestB = sprueB;

  for (let t = 0; t < triCount; t++) {
    const i1 = index ? index.getX(t * 3 + 0) : t * 3 + 0;
    const i2 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i3 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    const x1 = positions[i1 * 3 + 0], y1 = positions[i1 * 3 + 1], z1 = positions[i1 * 3 + 2];
    const x2 = positions[i2 * 3 + 0], y2 = positions[i2 * 3 + 1], z2 = positions[i2 * 3 + 2];
    const x3 = positions[i3 * 3 + 0], y3 = positions[i3 * 3 + 1], z3 = positions[i3 * 3 + 2];

    const cx = (x1 + x2 + x3) / 3;
    const cy = (y1 + y2 + y3) / 3;
    const cz = (z1 + z2 + z3) / 3;
    if (!isTopHalf(cx, cy, cz)) continue;

    const p1 = [x1, y1, z1];
    const p2 = [x2, y2, z2];
    const p3 = [x3, y3, z3];
    const a1 = p1[lateralA], b1 = p1[lateralB];
    const a2 = p2[lateralA], b2 = p2[lateralB];
    const a3 = p3[lateralA], b3 = p3[lateralB];

    if (pointInTriangle2D(sprueA, sprueB, a1, b1, a2, b2, a3, b3)) {
      return { inside: true, snapA: sprueA, snapB: sprueB };
    }

    // Track nearest triangle centroid (lateral) for the fallback snap.
    const pC = [cx, cy, cz];
    const cA = pC[lateralA], cB = pC[lateralB];
    const dA = cA - sprueA, dB = cB - sprueB;
    const d2 = dA * dA + dB * dB;
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearestA = cA;
      nearestB = cB;
    }
  }

  return { inside: false, snapA: nearestA, snapB: nearestB };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape-aware cross-section math
// ─────────────────────────────────────────────────────────────────────────────
//
// `clampToMoldInterior` pulls a desired channel (sprue or vent) point inward
// to the nearest safe location for a channel of the given radius. Shape-aware:
//   - rect / roundedRect: AABB inset by max(margin, cornerRadius).
//   - cylinder: circle of radius (cylinderRadius - margin).
// `fallbackVentSeeds` supplies MIN_VENTS-style fallback points that respect
// the shell shape so we don't place vents outside a cylinder's radius.
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
  const effMargin =
    env.shape === 'roundedRect'
      ? Math.max(margin, env.cornerRadius ?? 0)
      : margin;
  const minA = env.moldMin.getComponent(latAIdx) + effMargin;
  const maxA = env.moldMin.getComponent(latAIdx) + env.moldSize.getComponent(latAIdx) - effMargin;
  const minB = env.moldMin.getComponent(latBIdx) + effMargin;
  const maxB = env.moldMin.getComponent(latBIdx) + env.moldSize.getComponent(latBIdx) - effMargin;
  const clampedA = maxA >= minA ? Math.min(Math.max(latA, minA), maxA)
    : (env.moldMin.getComponent(latAIdx) + env.moldSize.getComponent(latAIdx) / 2);
  const clampedB = maxB >= minB ? Math.min(Math.max(latB, minB), maxB)
    : (env.moldMin.getComponent(latBIdx) + env.moldSize.getComponent(latBIdx) / 2);
  return [clampedA, clampedB];
}

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
    const d = r * Math.SQRT1_2 * 0.99;
    return [
      [cA + d, cB + d],
      [cA - d, cB + d],
      [cA - d, cB - d],
      [cA + d, cB - d],
    ];
  }
  const raw: [number, number][] = [
    [bbox.min.getComponent(latAIdx), bbox.min.getComponent(latBIdx)],
    [bbox.max.getComponent(latAIdx), bbox.max.getComponent(latBIdx)],
    [bbox.min.getComponent(latAIdx), bbox.max.getComponent(latBIdx)],
    [bbox.max.getComponent(latAIdx), bbox.min.getComponent(latBIdx)],
  ];
  return raw.map(([a, b]) => clampToMoldInterior(a, b, env, margin));
}

export function getRegistrationPinPositions(
  bbox: THREE.Box3,
  axis: Axis,
  splitPos: number,
  wallThickness: number,
  cutAngle = 0,
): [number, number, number][] {
  const inset = wallThickness * PIN_INSET_RATIO;
  const positions: [number, number, number][] = [];

  // Build plane lazily — only if we actually need to lift primary coords onto
  // a tilted plane. At cutAngle=0 we keep the flat splitPos scalar so output
  // is bit-identical to the pre-oblique behaviour.
  const plane = planeIfTilted(bbox, axis, splitPos, cutAngle);

  /** For a lateral (a, b) corner, return the primary coord on the plane. */
  const primaryAt = (x: number, y: number, z: number): number =>
    liftToPlane(plane, axis, splitPos, [x, y, z]);

  switch (axis) {
    case 'z': {
      const corners: Array<[number, number]> = [
        [bbox.min.x - inset, bbox.min.y - inset],
        [bbox.max.x + inset, bbox.min.y - inset],
        [bbox.min.x - inset, bbox.max.y + inset],
        [bbox.max.x + inset, bbox.max.y + inset],
      ];
      for (const [x, y] of corners) {
        positions.push([x, y, primaryAt(x, y, 0)]);
      }
      break;
    }
    case 'y': {
      const corners: Array<[number, number]> = [
        [bbox.min.x - inset, bbox.min.z - inset],
        [bbox.max.x + inset, bbox.min.z - inset],
        [bbox.min.x - inset, bbox.max.z + inset],
        [bbox.max.x + inset, bbox.max.z + inset],
      ];
      for (const [x, z] of corners) {
        positions.push([x, primaryAt(x, 0, z), z]);
      }
      break;
    }
    case 'x': {
      const corners: Array<[number, number]> = [
        [bbox.min.y - inset, bbox.min.z - inset],
        [bbox.max.y + inset, bbox.min.z - inset],
        [bbox.min.y - inset, bbox.max.z + inset],
        [bbox.max.y + inset, bbox.max.z + inset],
      ];
      for (const [y, z] of corners) {
        positions.push([primaryAt(0, y, z), y, z]);
      }
      break;
    }
  }

  return positions;
}

/**
 * Shape-aware registration pin placement.
 *
 * - `rect` / `roundedRect`: delegates to the legacy AABB-corner logic. The cap
 *   in `pickCornerRadius` guarantees pin bodies clear the rounded cutout for
 *   `roundedRect`. Pin lateral positions stay at the AABB corners even under
 *   tilt — Plan agent's explicit recommendation against generalising the
 *   cylinder radial strategy to rectangular shells.
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
  cutAngle = 0,
): [number, number, number][] {
  if (env.shape !== 'cylinder') {
    return getRegistrationPinPositions(bbox, env.axis, splitPos, env.wallThickness, cutAngle);
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

  const plane = planeIfTilted(bbox, env.axis, splitPos, cutAngle);

  const positions: [number, number, number][] = [];
  for (const [da, db] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const pos: [number, number, number] = [0, 0, 0];
    pos[latA] = centerA + da * pinRadialDist;
    pos[latB] = centerB + db * pinRadialDist;
    // Primary coord: splitPos for axis-aligned; lifted onto the tilted plane
    // otherwise so pins sit on the seam rather than at a meaningless scalar.
    pos[primary] = liftToPlane(plane, env.axis, splitPos, pos);
    positions.push(pos);
  }
  return positions;
}

/**
 * Rotation (in DEGREES) to orient a default-Z cylinder along the given axis.
 *
 * Direction matters: callers build cylinders with `Manifold.cylinder(h, …)`
 * which extends z∈(0, h) (i.e. +Z from origin), then `.rotate(...)` then
 * `.translate(basePos)`. We want the cylinder's body to end up extending in
 * the **positive** parting axis direction from `basePos` — so a sprue at
 * splitPos goes UP into the top mold and the subtract creates a hole.
 *
 *   axis='x' rotate Y +90°: (x,y,z) → (z, y, -x). Pre-rot z∈(0,h) → +X. ✓
 *   axis='y' rotate X -90°: (x,y,z) → (x, z, -y). Pre-rot z∈(0,h) → +Y. ✓
 *     (NOT +90° — that sends pre-rot +Z to -Y, which puts the sprue/vent
 *      cylinders BELOW splitPos in bottom-mold space. The subtract from
 *      topResult is then a no-op and the user gets no pour hole. Caught
 *      reproducing the Mr Coaster Y=58 rounded screenshot.)
 *   axis='z' identity:                                Pre-rot z∈(0,h) → +Z. ✓
 */
export function getRotationForAxis(axis: Axis): [number, number, number] {
  switch (axis) {
    case 'x': return [0, 90, 0];
    case 'y': return [-90, 0, 0];
    case 'z': return [0, 0, 0];
  }
}

/**
 * Options bag for computeChannelPositions. Kept as an options object (not
 * positional args) because the function already has 7 required params and
 * every future knob would push us further toward unreadable call sites.
 *
 * `sprueOverride`: user-specified lateral sprue position in the part's own
 * coordinate system. When present, the area-weighted-centroid computation
 * AND the cavity verification are both skipped — the user has said "put it
 * here", we respect that. The primary-axis coord is still lifted onto the
 * parting plane so the sprue sits on the seam rather than floating.
 *
 * Tradeoff: bypassing the cavity check means the user can position the sprue
 * over air, which produces a mold with no pour path. We log a dev warning in
 * that case but don't override the user's choice. The UI should render a
 * visible indicator when the override is outside the cavity so the user
 * notices before generating.
 */
export interface ComputeChannelOpts {
  sprueOverride?: { a: number; b: number };
}

/**
 * Compute sprue and vent positions using geometry analysis.
 *
 * Strategy:
 * - SPRUE: Analyze the part geometry to find the thickest cross-section in the
 *   "top" half (positive side of parting plane, per signed distance). Gate at
 *   the thickest point ensures material flows thick→thin, reducing shrinkage
 *   voids. For gravity casting, placing the gate high lets gravity assist the
 *   fill.
 *
 *   If `opts.sprueOverride` is given, skip centroid/verification entirely and
 *   use the user's lateral coords directly.
 *
 * - VENTS: Find the extremity vertices in the top half that are farthest from
 *   the sprue. These are where air gets trapped last. Also add vents at any
 *   local high points (vertices with high values along the split axis).
 *
 * - Under tilt (cutAngle ≠ 0), the "top half" test uses signed distance from
 *   the plane rather than a single-coord compare, and the sprue/vents are
 *   *lifted* to sit on the tilted plane (primary axis coord solved via
 *   `primaryAxisValueOnPlane`).
 *
 * Manifold.cylinder() creates along Z by default, so we return a rotation
 * (in degrees) to orient the holes along the parting axis. Within the ±30°
 * tilt cap the cylinders stay close enough to the plane normal that this
 * axis-aligned orientation is acceptable for v1 — see module header.
 */
/**
 * Shape-aware variant — this is where the logic lives. Legacy
 * `computeChannelPositions` below delegates here with a synthesized rect
 * envelope + zero margins so existing tests/callers stay bit-compatible.
 *
 * `margins.sprueMargin` / `margins.ventMargin` should be passed as
 * `holeRadius + safetyWall` (generateMold.ts uses 0.5× wallThickness for the
 * sprue and 0.3× for vents).
 */
export function computeChannelPositionsForEnvelope(
  env: MoldEnvelope,
  bbox: THREE.Box3,
  splitPos: number,
  geometry: THREE.BufferGeometry,
  margins: { sprueMargin: number; ventMargin: number } = { sprueMargin: 0, ventMargin: 0 },
  cutAngle = 0,
  opts: ComputeChannelOpts = {},
): {
  spruePos: [number, number, number];
  sprueHeight: number;
  ventPositions: [number, number, number][];
  rotation: [number, number, number];
} {
  const axis = env.axis;
  const moldMin = env.moldMin;
  const moldSize = env.moldSize;
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);

  const axisIdx = primaryAxisIndex(axis);
  const topFaceVal = moldMin.getComponent(axisIdx) + moldSize.getComponent(axisIdx);

  const plane = planeIfTilted(bbox, axis, splitPos, cutAngle);

  const positions = geometry.attributes.position.array;
  const vertCount = positions.length / 3;

  // ── Top-half classifier ──
  // For cutAngle=0 this degenerates to the old `coord >= splitPos` scalar
  // compare — bit-identical behaviour. For tilted cuts we compute signed
  // distance from the plane; >= 0 means "on the normal-pointing side".
  const isTopHalf = (x: number, y: number, z: number): boolean => {
    if (!plane) {
      const coord = axisIdx === 0 ? x : axisIdx === 1 ? y : z;
      return coord >= splitPos;
    }
    return signedDistance([x, y, z], plane) >= 0;
  };

  const lateralA = (axisIdx + 1) % 3;
  const lateralB = (axisIdx + 2) % 3;

  // ── Centroid state, populated from either the override or the geometry ──
  // (Declared here so the vent clustering below can read from these.)
  let centroidA: number;
  let centroidB: number;

  const spruePos: [number, number, number] = [0, 0, 0];

  if (opts.sprueOverride) {
    // ── User override path ──
    // The user has asked for the sprue to land at a specific (a, b) point.
    // Respect it: skip the centroid computation AND the cavity verification.
    // Still lift the primary coord onto the plane so the sprue sits on the
    // seam under tilt. We do run a *check-only* cavity verification just to
    // emit a dev warning; we do NOT modify the position.
    // Clamp even in the override path so the user can't request a position
    // that would pierce the outer shell wall — the mold-wall constraint is
    // physical, not a user preference.
    [centroidA, centroidB] = clampToMoldInterior(
      opts.sprueOverride.a, opts.sprueOverride.b, env, margins.sprueMargin,
    );
    spruePos[lateralA] = centroidA;
    spruePos[lateralB] = centroidB;
    spruePos[axisIdx] = liftToPlane(plane, axis, splitPos, spruePos);

    const check = verifyLateralOverCavity(
      centroidA, centroidB,
      positions, geometry.index,
      lateralA, lateralB,
      isTopHalf,
    );
    if (!check.inside) {
      dbg(`Sprue override (${centroidA.toFixed(2)}, ${centroidB.toFixed(2)}) is outside the cavity — the mold may have no pour path. Nearest material is at (${check.snapA.toFixed(2)}, ${check.snapB.toFixed(2)}).`);
    }
  } else {
    // ── Automatic placement path ──
    // Area-weighted centroid of top-half surface. Each triangle contributes
    // (centroid × area), so a unit of ACTUAL SURFACE AREA gets equal weight
    // regardless of how finely it's tessellated.
    //
    // Why this matters: earlier versions summed raw vertex positions, which
    // biased the sprue toward whichever region of the part had the most
    // vertices. On a coaster-like shape the top (curved) surface often carries
    // many more triangles than the flat bottom, pulling the sprue off-center
    // even though the actual mass of the part is symmetric. Area-weighting
    // fixes this — the sprue now lands at the surface centroid, which is a
    // much better proxy for "the bulk of the part".
    //
    // Top-half classification is per-triangle (via the triangle's own centroid)
    // rather than per-vertex. Triangles that straddle the parting plane
    // contribute to whichever side their centroid falls on. This is a slight
    // approximation — an exact answer requires cutting the mesh at the plane —
    // but the error shrinks as mesh resolution grows and is dominated by the
    // correction over vertex-averaging in every realistic case.
    let sumA = 0, sumB = 0, totalArea = 0;

    const index = geometry.index;
    const triCount = index ? index.count / 3 : vertCount / 3;

    for (let t = 0; t < triCount; t++) {
      const i1 = index ? index.getX(t * 3 + 0) : t * 3 + 0;
      const i2 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i3 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

      const x1 = positions[i1 * 3 + 0], y1 = positions[i1 * 3 + 1], z1 = positions[i1 * 3 + 2];
      const x2 = positions[i2 * 3 + 0], y2 = positions[i2 * 3 + 1], z2 = positions[i2 * 3 + 2];
      const x3 = positions[i3 * 3 + 0], y3 = positions[i3 * 3 + 1], z3 = positions[i3 * 3 + 2];

      // Triangle centroid — used both for the top-half test and as the
      // area-weighted sample point for the surface centroid integral.
      const cx = (x1 + x2 + x3) / 3;
      const cy = (y1 + y2 + y3) / 3;
      const cz = (z1 + z2 + z3) / 3;

      if (!isTopHalf(cx, cy, cz)) continue;

      // Triangle area = |cross(v2 - v1, v3 - v1)| / 2
      const ex = x2 - x1, ey = y2 - y1, ez = z2 - z1;
      const fx = x3 - x1, fy = y3 - y1, fz = z3 - z1;
      const nx = ey * fz - ez * fy;
      const ny = ez * fx - ex * fz;
      const nz = ex * fy - ey * fx;
      const area = Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;

      const cArr = [cx, cy, cz];
      sumA += cArr[lateralA] * area;
      sumB += cArr[lateralB] * area;
      totalArea += area;
    }

    centroidA = totalArea > 0 ? sumA / totalArea : center.getComponent(lateralA);
    centroidB = totalArea > 0 ? sumB / totalArea : center.getComponent(lateralB);

    // Sprue: lateral coords at the centroid, primary coord lifted onto the
    // parting plane (so a tilted cut doesn't float the sprue above or below
    // the seam).
    spruePos[lateralA] = centroidA;
    spruePos[lateralB] = centroidB;
    spruePos[axisIdx] = liftToPlane(plane, axis, splitPos, spruePos);

    // ── Sprue-inside-cavity verification ──
    // The area-weighted surface centroid is mathematically correct but can fall
    // in a HOLE for non-convex parts — e.g. the center of a donut. The resulting
    // sprue cylinder would then carve through solid mold material without ever
    // reaching the cavity → no pour path. Verify the centroid sits over actual
    // material on the parting plane, and if not, snap to the nearest top-half
    // triangle centroid (which IS guaranteed to be on material).
    const verification = verifyLateralOverCavity(
      spruePos[lateralA], spruePos[lateralB],
      positions, geometry.index,
      lateralA, lateralB,
      isTopHalf,
    );
    if (!verification.inside) {
      const origA = spruePos[lateralA];
      const origB = spruePos[lateralB];
      spruePos[lateralA] = verification.snapA;
      spruePos[lateralB] = verification.snapB;
      spruePos[axisIdx] = liftToPlane(plane, axis, splitPos, spruePos);
      // Keep the centroid coords in sync so vent clustering uses the
      // corrected anchor rather than the "before" point in the hole.
      centroidA = verification.snapA;
      centroidB = verification.snapB;
      dbg(`Sprue centroid (${origA.toFixed(2)}, ${origB.toFixed(2)}) was outside cavity — snapped to (${verification.snapA.toFixed(2)}, ${verification.snapB.toFixed(2)})`);
    }

    // Final clamp — ensure the sprue's lateral position sits inside the mold
    // cross-section with at least sprueMargin of shell wall around it. For
    // margins=0 (back-compat path) and rect shape this is a no-op on any
    // centroid already inside the part's bbox.
    [spruePos[lateralA], spruePos[lateralB]] = clampToMoldInterior(
      spruePos[lateralA], spruePos[lateralB], env, margins.sprueMargin,
    );
    spruePos[axisIdx] = liftToPlane(plane, axis, splitPos, spruePos);
    centroidA = spruePos[lateralA];
    centroidB = spruePos[lateralB];
  }

  // Sprue height measures from the mold's top face down to the gate. For an
  // axis-aligned cut this is the old `topFaceVal - splitPos`; under tilt we
  // use the actual gate primary coord so the sprue doesn't over/undershoot.
  const sprueHeight = topFaceVal - spruePos[axisIdx];

  // ── Find optimal vent positions ──
  // Sample every Nth vertex to cap the candidate array size.
  const sampleStep = Math.max(1, Math.floor(vertCount / VENT_CANDIDATE_SAMPLE_CAP));
  const ventCandidates: { dist: number; a: number; b: number }[] = [];

  for (let i = 0; i < vertCount; i += sampleStep) {
    const x = positions[i * 3 + 0];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (isTopHalf(x, y, z)) {
      const a = positions[i * 3 + lateralA];
      const b = positions[i * 3 + lateralB];
      const dist = Math.sqrt((a - centroidA) ** 2 + (b - centroidB) ** 2);
      ventCandidates.push({ dist, a, b });
    }
  }

  ventCandidates.sort((x, y) => y.dist - x.dist);

  // Cluster the farthest points into distinct vent locations
  const ventPositions: [number, number, number][] = [];
  const minVentSpacing = Math.max(bboxSize.getComponent(lateralA), bboxSize.getComponent(lateralB)) * VENT_MIN_SPACING_RATIO;

  const pushVent = (a: number, b: number) => {
    const pos: [number, number, number] = [0, 0, 0];
    pos[lateralA] = a;
    pos[lateralB] = b;
    // Lift onto the plane: axis-aligned case returns splitPos unchanged.
    pos[axisIdx] = liftToPlane(plane, axis, splitPos, pos);
    ventPositions.push(pos);
  };

  for (const candidate of ventCandidates) {
    if (ventPositions.length >= MAX_VENTS) break;

    // Clamp first so the too-close check runs against the clamped position.
    const [ca, cb] = clampToMoldInterior(candidate.a, candidate.b, env, margins.ventMargin);

    const tooClose = ventPositions.some(vp => {
      const da = vp[lateralA] - ca;
      const db = vp[lateralB] - cb;
      return Math.sqrt(da * da + db * db) < minVentSpacing;
    });

    if (!tooClose) pushVent(ca, cb);
  }

  // Ensure at least MIN_VENTS vents: if clustering eliminated too many, use
  // shape-aware fallback seeds. Bbox corners would sit outside a cylinder's
  // radius and pierce the shell wall — `fallbackVentSeeds` returns points
  // already inside each shape's cross-section.
  if (ventPositions.length < MIN_VENTS) {
    for (const [ca, cb] of fallbackVentSeeds(env, bbox, margins.ventMargin)) {
      if (ventPositions.length >= MIN_VENTS) break;
      pushVent(ca, cb);
    }
  }

  // Rotation to orient cylinders along the split axis (DEGREES — manifold-3d
  // convention). Shared with registration pins via getRotationForAxis so the
  // two axes of "point a cylinder along this axis" don't drift.
  const rotation = getRotationForAxis(axis);

  dbg(`Sprue at [${spruePos.map(v => v.toFixed(1))}], ${ventPositions.length} vents, height ${sprueHeight.toFixed(1)}`);

  return { spruePos, sprueHeight, ventPositions, rotation };
}

/**
 * Back-compat wrapper for the legacy signature. Synthesizes a rect envelope
 * with zero margins and delegates to `computeChannelPositionsForEnvelope`.
 *
 * The clamp/fallback helpers are effectively no-ops under margins=0 + rect
 * shape for any point already inside the part's bbox — so behaviour stays
 * bit-compatible with the pre-shape-aware code path. Tests and callers that
 * haven't migrated to the envelope signature (e.g. repro_coasterBug) keep
 * working unchanged.
 */
export function computeChannelPositions(
  bbox: THREE.Box3,
  axis: Axis,
  splitPos: number,
  moldMin: THREE.Vector3,
  moldSize: THREE.Vector3,
  geometry: THREE.BufferGeometry,
  cutAngle = 0,
  opts: ComputeChannelOpts = {},
): {
  spruePos: [number, number, number];
  sprueHeight: number;
  ventPositions: [number, number, number][];
  rotation: [number, number, number];
} {
  const env: MoldEnvelope = {
    shape: 'rect',
    axis,
    wallThickness: 0,
    moldMin: moldMin.clone(),
    moldSize: moldSize.clone(),
  };
  return computeChannelPositionsForEnvelope(
    env, bbox, splitPos, geometry,
    { sprueMargin: 0, ventMargin: 0 },
    cutAngle, opts,
  );
}
