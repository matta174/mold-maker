/**
 * Parting-plane math.
 *
 * Why this module exists: until oblique cuts landed, a parting plane was just
 * (axis, offset) — three cardinal orientations, zero tilt. The CSG, pin
 * placement, sprue/vent classification, and draft-heatmap code all assumed
 * the plane normal was axis-aligned and compared "which side?" with a single
 * coordinate component (e.g. `vertex.z >= splitZ`).
 *
 * For oblique cuts the plane is described by a full normal vector plus a
 * scalar `originOffset` (Manifold's own half-space convention). The
 * "which side?" test generalises to the signed distance:
 *     side = sign(dot(vertex, normal) - originOffset)
 *
 * This file produces those two numbers from the user-facing controls
 * (axis + offset + cutAngle) as pure functions, no THREE.js or WASM, so the
 * math can be unit-tested in isolation and the caller can't miswire the two
 * halves.
 *
 * v1 scope: one tilt axis per parting axis. The hinge is fixed — tilting a
 * Z-split rotates the plane around the X-axis, tilting X rotates around Y,
 * tilting Y rotates around Z. This is enough to cover real parts; a second
 * `tiltAxis` parameter can be added later without breaking the data model.
 *
 * Cap: ±30° tilt. Above that, sprues pour sideways, vents misalign with
 * actual high points, and the CSG solver starts struggling. See
 * `docs/launch/checklist.md` for the discussion.
 */

import type { Axis } from '../types';
import { dbg } from './constants';

/** Maximum absolute cut angle, in degrees. See header comment. */
export const MAX_CUT_ANGLE_DEGREES = 30;

/** Plain 3-tuple. Avoids a THREE.Vector3 dependency in this pure module. */
export type Vec3 = readonly [number, number, number];

/**
 * Pair of numbers describing a parting plane in Manifold's half-space form.
 *   - `normal`   : unit vector, the plane's outward normal
 *   - `originOffset` : signed distance from world origin to the plane,
 *                      measured along `normal`. Pass this straight to
 *                      `Manifold.splitByPlane(normal, originOffset)`.
 *
 * Any point `p` satisfies `dot(p, normal) - originOffset >= 0` iff `p` is
 * on the positive (normal-pointing) side of the plane.
 */
export interface PlaneEquation {
  normal: Vec3;
  originOffset: number;
}

/** Return the unit vector corresponding to an axis letter. */
function axisUnitVector(axis: Axis): Vec3 {
  switch (axis) {
    case 'x': return [1, 0, 0];
    case 'y': return [0, 1, 0];
    case 'z': return [0, 0, 1];
  }
}

/**
 * Pick the hinge axis (tilt axis) for a given parting axis.
 *
 *   parting axis → hinge axis
 *      x          →   y
 *      y          →   z
 *      z          →   x
 *
 * Why this particular cycle: it's the right-handed cyclic permutation, so
 * a positive tilt angle always rotates the plane normal "clockwise when
 * viewed from the hinge's positive end". Having a single, documented rule
 * avoids the ambiguity that came up in review — for a Z-split the user
 * could have meant "tilt toward X" or "tilt toward Y"; this picks one.
 *
 * Exposed so the UI layer can label the slider ("tilt Z toward X") without
 * duplicating the convention.
 */
export function hingeAxisFor(axis: Axis): Axis {
  switch (axis) {
    case 'x': return 'y';
    case 'y': return 'z';
    case 'z': return 'x';
  }
}

/**
 * Compute the plane normal for a given parting axis and tilt angle.
 *
 * At tiltAngle=0 this returns the pristine axis unit vector — not a computed
 * approximation — so the axis-aligned fast path is a bitwise identity. That
 * matters for backwards compat: existing mold exports regenerate byte-for-byte
 * at cutAngle=0.
 *
 * For non-zero tilts, we rotate the base normal around `hingeAxisFor(axis)`
 * by `tiltAngle` degrees. Rodrigues is overkill for rotation around a
 * cardinal axis — the result has a closed form.
 *
 * @param axis        parting axis ('x' | 'y' | 'z')
 * @param tiltAngle   rotation around the hinge axis, degrees. 0 = axis-aligned.
 * @returns           a unit vector (length 1 by construction)
 */
export function getPlaneNormal(axis: Axis, tiltAngle = 0): Vec3 {
  if (tiltAngle === 0) return axisUnitVector(axis);

  const rad = (tiltAngle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);

  // Closed-form cardinal-axis rotation applied to the base axis unit vector.
  // Hinge axes are fixed by hingeAxisFor() (y for x-split, z for y-split, x for z-split).
  switch (axis) {
    case 'x':
      // Rotate [1,0,0] around +Y by tiltAngle → [cos, 0, -sin]
      return [c, 0, -s];
    case 'y':
      // Rotate [0,1,0] around +Z by tiltAngle → [sin, cos, 0]
      return [s, c, 0];
    case 'z':
      // Rotate [0,0,1] around +X by tiltAngle → [0, -sin, cos]
      return [0, -s, c];
  }
}

/**
 * Compute the full plane equation (normal + originOffset) for a parting
 * plane defined by (axis, offset, tiltAngle) inside a given bounding box.
 *
 * The plane passes through a "pivot point" — the point on the base axis
 * at the given offset (0..1) within `bboxMin..bboxMax`. The tilt rotates
 * the plane *around this pivot*, so at any tilt angle the plane still
 * intersects the pivot. This matches user intent: move the slider, you
 * move the cut's centre; move the angle, you rotate around that centre.
 *
 * `originOffset` is `dot(pivot, normal)` — the scalar Manifold needs to
 * place the half-space.
 *
 * @param bboxMin     min corner of the part's AABB (Vec3)
 * @param bboxMax     max corner of the part's AABB (Vec3)
 * @param axis        parting axis
 * @param offset      0..1 along the parting axis within the bbox
 * @param tiltAngle   degrees, 0..MAX_CUT_ANGLE_DEGREES. Defaults to 0.
 */
export function getPlaneEquation(
  bboxMin: Vec3,
  bboxMax: Vec3,
  axis: Axis,
  offset: number,
  tiltAngle = 0,
): PlaneEquation {
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

  // Defensive clamp — every caller eventually hits this path (draftAnalysis,
  // channelPlacement, generateMold), so clamping here is cheaper than asking
  // each caller to remember. `clampCutAngle` also maps NaN/Infinity → 0, which
  // prevents a bad input from poisoning the plane normal and silently painting
  // the whole heatmap red with no explanation.
  const safeTilt = clampCutAngle(tiltAngle);

  // Pivot point: centred laterally in the bbox, at `offset` along the axis.
  // Lateral centring is arbitrary but stable — a pivot at (0, 0, z) would
  // tilt differently than the part's actual centre.
  const pivot: Vec3 = [
    (bboxMin[0] + bboxMax[0]) / 2,
    (bboxMin[1] + bboxMax[1]) / 2,
    (bboxMin[2] + bboxMax[2]) / 2,
  ];
  // Override the along-axis component with the sliced position.
  const pivotMutable: [number, number, number] = [pivot[0], pivot[1], pivot[2]];
  pivotMutable[axisIdx] =
    bboxMin[axisIdx] + (bboxMax[axisIdx] - bboxMin[axisIdx]) * offset;

  const normal = getPlaneNormal(axis, safeTilt);
  const originOffset =
    pivotMutable[0] * normal[0] +
    pivotMutable[1] * normal[1] +
    pivotMutable[2] * normal[2];

  return { normal, originOffset };
}

/**
 * Signed distance from a point to the plane, positive on the normal side.
 * Exposed for the draft-analysis and vent/sprue classification code, which
 * needs to answer "is this vertex in the top half?" — a scalar check that
 * generalises the old `vertex[axisIdx] >= splitPos`.
 */
export function signedDistance(point: Vec3, plane: PlaneEquation): number {
  return (
    point[0] * plane.normal[0] +
    point[1] * plane.normal[1] +
    point[2] * plane.normal[2] -
    plane.originOffset
  );
}

/**
 * Given lateral coordinates, compute the primary-axis value that places a
 * point *exactly on* the parting plane.
 *
 * This is the inverse of "is this point above the plane?" for the fixed-
 * lateral case: pick two lateral coords (e.g. the lateral coords of a sprue or
 * registration pin), this returns the third coord such that the resulting
 * point satisfies `dot(point, normal) = originOffset`.
 *
 * Used by channel placement so sprues, vents, and registration pins sit
 * *on* the tilted parting plane rather than at a fixed `splitPos` that no
 * longer makes sense once the plane is rotated.
 *
 * Safety: within MAX_CUT_ANGLE_DEGREES (=30°) the plane's primary-axis
 * component is always cos(tilt) ≥ √3/2 ≈ 0.866, so the division is stable.
 * We guard anyway for future-proofing against a widened cap.
 */
export function primaryAxisValueOnPlane(
  plane: PlaneEquation,
  axis: Axis,
  lateralPoint: Vec3,
): number {
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const primaryComp = plane.normal[axisIdx];
  if (Math.abs(primaryComp) < 1e-9) {
    // Plane is perpendicular to the primary axis — there's no single answer.
    // Inside the supported tilt range this is unreachable (cos 30° ≈ 0.866),
    // so hitting this branch means either the cap was widened or a caller
    // bypassed `clampCutAngle`. Log loudly in dev; silent 0 would shift
    // sprues/pins to the origin with no explanation. Still return 0 rather
    // than NaN so downstream arithmetic doesn't propagate garbage.
    dbg(
      `primaryAxisValueOnPlane: plane near-perpendicular to axis=${axis} ` +
      `(normal[${axisIdx}]=${primaryComp}); returning 0 as fallback. ` +
      `Tilt cap likely exceeded — widening MAX_CUT_ANGLE_DEGREES requires ` +
      `revisiting this function.`,
    );
    return 0;
  }
  // dot(point, normal) = originOffset, solved for point[axisIdx]:
  //   normal[axisIdx] * p = originOffset − Σ(other components · their normals)
  let sumOther = 0;
  for (let i = 0; i < 3; i++) {
    if (i === axisIdx) continue;
    sumOther += lateralPoint[i] * plane.normal[i];
  }
  return (plane.originOffset - sumOther) / primaryComp;
}

/**
 * Minimal structural type matching `THREE.Box3` — `.min`/`.max` with x/y/z.
 * Lets this module offer a Box3-friendly helper without importing THREE
 * (which would defeat the "pure math, no GL deps" purpose of the file).
 */
export interface BboxLike {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * THREE.Box3 → PlaneEquation adapter, shared by draftAnalysis and
 * channelPlacement. Structural typing means any `{min:{x,y,z}, max:{x,y,z}}`
 * works — no THREE dependency sneaks into this module.
 *
 * Prefer this over duplicating the bbox-unpack dance in each caller.
 */
export function planeFromBox(
  bbox: BboxLike, axis: Axis, offset: number, tiltAngle = 0,
): PlaneEquation {
  const min: Vec3 = [bbox.min.x, bbox.min.y, bbox.min.z];
  const max: Vec3 = [bbox.max.x, bbox.max.y, bbox.max.z];
  return getPlaneEquation(min, max, axis, offset, tiltAngle);
}

/**
 * Clamp a raw tilt value to the supported range.
 *
 * The range is [-MAX_CUT_ANGLE_DEGREES, +MAX_CUT_ANGLE_DEGREES] — negative
 * values are allowed so the user can tilt either direction around the hinge.
 * The UI slider will be 0..30; apps feeding the API directly can pass either
 * sign. Either way, anything outside the range is clamped (loud, not silent:
 * if you pass 90, you get 30, and hopefully your QA catches the mismatch).
 */
export function clampCutAngle(tiltAngle: number): number {
  if (!Number.isFinite(tiltAngle)) return 0;
  if (tiltAngle > MAX_CUT_ANGLE_DEGREES) return MAX_CUT_ANGLE_DEGREES;
  if (tiltAngle < -MAX_CUT_ANGLE_DEGREES) return -MAX_CUT_ANGLE_DEGREES;
  return tiltAngle;
}
