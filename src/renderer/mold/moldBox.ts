import * as THREE from 'three';
import type { Axis, MoldBoxShape } from '../types';
import { PIN_INSET_RATIO } from './constants';

/**
 * Mold box / outer shell geometry.
 *
 * Why this module exists: the original `generateMold` assumed the mold was
 * always an axis-aligned rectangular box, with `moldSize`/`moldMin` computed
 * directly from the part bounding box plus wall thickness. Once we need
 * cylindrical or rounded-rectangular shells the envelope math stops being
 * trivially a bbox grow — the cylinder has to contain the *bounding circle*
 * of the part's lateral cross-section, and the rounded-rect has to pick a
 * corner radius that's actually buildable.
 *
 * The approach: all shape math lives here, as pure functions, with a single
 * Manifold-calling factory (`createMoldBoxManifold`) at the bottom. The pure
 * parts can be unit tested without spinning up WASM.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Envelope representation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uniform description of the mold's outer shell.
 *
 * The AABB fields (`moldMin`, `moldSize`) are populated for *all* shapes — they
 * are useful to downstream code that needs to reason about the outer bounds
 * without caring about the exact silhouette (e.g. sizing the infinite-plane
 * cutters that split the mold into halves). For non-rect shapes they describe
 * the bounding box OF the shell, not a rectangular shell itself.
 *
 * Shape-specific fields fill in the rest. Only the fields relevant to the
 * active `shape` are meaningful; others are set to sentinel values.
 */
export interface MoldEnvelope {
  shape: MoldBoxShape;
  /** Parting axis — also the prism axis for cylinder and roundedRect. */
  axis: Axis;
  /** Wall thickness (absolute, in the same units as the part geometry). */
  wallThickness: number;
  /** AABB min corner of the outer shell. Valid for every shape. */
  moldMin: THREE.Vector3;
  /** AABB size of the outer shell. Valid for every shape. */
  moldSize: THREE.Vector3;

  // ── Cylinder-only ──
  /** Radius of the cylinder cross-section (perpendicular to the parting axis). */
  cylinderRadius?: number;
  /** Center of the cylinder cross-section in world coords (the two lateral
   *  components, indexed by the non-parting axes). Not the 3D center — the
   *  along-axis coordinate is not meaningful. */
  cylinderCenterLatA?: number;
  cylinderCenterLatB?: number;

  // ── RoundedRect-only ──
  /** Corner radius of the rounded-rect cross-section. Rounds only the 4
   *  vertical edges along the parting axis; top/bottom faces stay flat. */
  cornerRadius?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure math
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indices for the lateral axes perpendicular to a parting axis.
 * For axis='z', lateral axes are [x=0, y=1].
 */
export function lateralAxisIndices(axis: Axis): [number, number] {
  const primary = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  return [(primary + 1) % 3, (primary + 2) % 3];
}

/** Along-axis index (0/1/2 for x/y/z). */
export function primaryAxisIndex(axis: Axis): number {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

/**
 * Pick the corner radius of a rounded-rect mold. Capped such that:
 *
 *   1. The radius never exceeds half the shorter lateral dimension
 *      (otherwise the "rectangle" is actually a squished stadium).
 *
 *   2. The radius never exceeds `wallThickness * (1 - PIN_INSET_RATIO)`.
 *      Registration pins are placed at `bboxCorner - PIN_INSET_RATIO*wall`
 *      — i.e., `(1 - PIN_INSET_RATIO) * wall` inward from the outer face of
 *      the wall. If `r` grows past that, the pin center enters the rounded
 *      cutout and the pin body intersects air instead of material. So the
 *      safe cap is exactly the pin's offset from the outer face.
 *
 * Implication: with the default PIN_INSET_RATIO=0.7, rounding is at most
 * 0.3 × wallThickness — a noticeable chamfer, not a capsule. That's the
 * right aesthetic tradeoff for FDM: just enough curvature to prevent outer-
 * corner delamination, not so much that we lose registration-pin material.
 */
export function pickCornerRadius(
  latSizeA: number,
  latSizeB: number,
  wallThickness: number,
): number {
  const shorterHalfLateral = Math.min(latSizeA, latSizeB) / 2;
  const wallBound = wallThickness * (1 - PIN_INSET_RATIO);
  return Math.max(0, Math.min(shorterHalfLateral, wallBound));
}

/**
 * Compute the mold envelope for a given part bbox, shape, parting axis, and
 * wall thickness.
 *
 * Strategy per shape:
 *
 *   RECT:
 *     moldMin  = bboxMin - wallThickness on each axis
 *     moldSize = bboxSize + 2*wallThickness on each axis
 *     (exactly the legacy behaviour of generateMold.ts)
 *
 *   CYLINDER (axis = parting axis):
 *     Along the parting axis, behave like rect — grow by wallThickness at both
 *     ends. Perpendicular to the parting axis, compute the bounding circle of
 *     the part (radius = sqrt((halfLatA)^2 + (halfLatB)^2)) and grow by
 *     wallThickness. The AABB of the shell is the square around this circle,
 *     extruded along the axis.
 *
 *   ROUNDED_RECT (axis = prism axis):
 *     Same AABB math as rect, but also pick a cornerRadius via pickCornerRadius.
 */
export function computeMoldEnvelope(
  bbox: THREE.Box3,
  shape: MoldBoxShape,
  axis: Axis,
  wallThickness: number,
): MoldEnvelope {
  const primary = primaryAxisIndex(axis);
  const [latA, latB] = lateralAxisIndices(axis);

  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);

  if (shape === 'rect' || shape === 'roundedRect') {
    const moldSize = new THREE.Vector3(
      bboxSize.x + wallThickness * 2,
      bboxSize.y + wallThickness * 2,
      bboxSize.z + wallThickness * 2,
    );
    const moldMin = new THREE.Vector3(
      bbox.min.x - wallThickness,
      bbox.min.y - wallThickness,
      bbox.min.z - wallThickness,
    );
    if (shape === 'rect') {
      return { shape, axis, wallThickness, moldMin, moldSize };
    }
    // roundedRect
    const latSizeA = bboxSize.getComponent(latA);
    const latSizeB = bboxSize.getComponent(latB);
    const cornerRadius = pickCornerRadius(latSizeA, latSizeB, wallThickness);
    return { shape, axis, wallThickness, moldMin, moldSize, cornerRadius };
  }

  // cylinder
  const halfLatA = bboxSize.getComponent(latA) / 2;
  const halfLatB = bboxSize.getComponent(latB) / 2;
  const partCircleRadius = Math.sqrt(halfLatA * halfLatA + halfLatB * halfLatB);
  const cylinderRadius = partCircleRadius + wallThickness;

  const bboxCenter = new THREE.Vector3();
  bbox.getCenter(bboxCenter);
  const cylinderCenterLatA = bboxCenter.getComponent(latA);
  const cylinderCenterLatB = bboxCenter.getComponent(latB);

  // AABB of the shell: square around the cylinder cross-section, extruded
  // by the part's axis-extent plus wallThickness at both ends.
  const moldSize = new THREE.Vector3();
  moldSize.setComponent(primary, bboxSize.getComponent(primary) + wallThickness * 2);
  moldSize.setComponent(latA, cylinderRadius * 2);
  moldSize.setComponent(latB, cylinderRadius * 2);

  const moldMin = new THREE.Vector3();
  moldMin.setComponent(primary, bbox.min.getComponent(primary) - wallThickness);
  moldMin.setComponent(latA, cylinderCenterLatA - cylinderRadius);
  moldMin.setComponent(latB, cylinderCenterLatB - cylinderRadius);

  return {
    shape, axis, wallThickness, moldMin, moldSize,
    cylinderRadius, cylinderCenterLatA, cylinderCenterLatB,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifold factory
// ─────────────────────────────────────────────────────────────────────────────

/** Segments to use for cylinder / rounded-corner approximation. 64 is smooth
 *  to the eye at typical mold sizes without blowing up triangle count. */
const CIRCULAR_SEGMENTS = 64;

/**
 * Map the world-space mold size onto the (csX, csY, length) of a +Z-extruded
 * prism that, after axis-rotation, will land with the right extents along the
 * right world axes.
 *
 * Why this exists as a pure function: the prior implementation tried to derive
 * `csX, csY` from `lateralAxisIndices(axis)`, which gave (primary+1, primary+2)
 * mod 3. That assignment looks symmetric but doesn't match the rotations we
 * actually apply — `rotate([90,0,0])` sends the prism's +Y to world +Z (not to
 * the "next" lateral index), and `rotate([0,90,0])` sends prism +X to world -Z
 * (also not the "next" index). So the extruded prism ended up with its sides
 * swapped vs. the part bbox for axis='y' and axis='x'. With axis='z' the
 * rotation is identity and the bug never surfaced — every existing integration
 * test uses axis='z'.
 *
 * The rotation conventions are:
 *
 *   axis='z' (identity):                            (csX, csY, L) → world (X, Y, Z)
 *   axis='y' (rotate X by -90°): (x,y,z) → (x, z, -y)
 *                                                  (csX, csY, L) → world (X, ±Y, Z)
 *           — Y extent of the prism is L, with the prism centered at origin
 *             before translation. (We use -90° not +90° so cylinders extend
 *             in +Y from base — see getRotationForAxis() in channelPlacement.)
 *   axis='x' (rotate Y by +90°): (x,y,z) → (z, y, -x)
 *                                                  (csX, csY, L) → world (X, Y, ±Z)
 *
 * So `csX` always matches the "first non-extrude axis" (in dictionary order
 * skipping the parting axis): for axis='y' that's X, for axis='x' that's Z.
 * `csY` is the remaining lateral. `length` is the parting-axis extent.
 */
export function csDimsForAxis(
  axis: Axis,
  moldSize: THREE.Vector3,
): { csX: number; csY: number; length: number } {
  if (axis === 'z') {
    return { csX: moldSize.x, csY: moldSize.y, length: moldSize.z };
  }
  if (axis === 'y') {
    return { csX: moldSize.x, csY: moldSize.z, length: moldSize.y };
  }
  // axis === 'x'
  return { csX: moldSize.z, csY: moldSize.y, length: moldSize.x };
}

/**
 * Create the Manifold representing the solid outer shell of the mold (before
 * the part cavity and channels are subtracted).
 *
 * Strategy (all non-rect shapes): build the prism along +Z **centered at
 * origin** (cylinder via the `centered` flag; roundedRect via an explicit
 * `translate([0,0,-L/2])` after extrude), rotate into the parting-axis frame,
 * then translate the whole thing to the envelope's AABB center. By keeping
 * the manifold centered before rotation, we sidestep the direction-of-rotation
 * problem entirely — the rotated prism is still centered at origin, so the
 * final translate is just the envelope center regardless of axis.
 *
 * For the rect shape we keep the original cube + corner translate — there's no
 * rotation, so the same code matches the previous behaviour byte-for-byte and
 * is the fastest path.
 *
 * Implementation note on roundedRect: we build the 2D cross-section with
 * `CrossSection.square + offset(r, 'Round')` rather than chaining four corner
 * squares + circles because Clipper2's 'Round' join does the work cleanly and
 * matches the Manifold idioms used elsewhere in the project.
 */
export function createMoldBoxManifold(wasm: any, env: MoldEnvelope): any {
  const { Manifold, CrossSection } = wasm;

  if (env.shape === 'rect') {
    return Manifold.cube(
      [env.moldSize.x, env.moldSize.y, env.moldSize.z],
      false,
    ).translate([env.moldMin.x, env.moldMin.y, env.moldMin.z]);
  }

  const { csX, csY, length } = csDimsForAxis(env.axis, env.moldSize);

  let m: any;

  if (env.shape === 'cylinder') {
    if (env.cylinderRadius === undefined) {
      throw new Error('cylinder envelope missing cylinderRadius');
    }
    // Centered cylinder: extends from z=-L/2 to z=L/2, centered in XY.
    m = Manifold.cylinder(
      length,
      env.cylinderRadius,
      env.cylinderRadius,
      CIRCULAR_SEGMENTS,
      true, // centered
    );
  } else {
    // roundedRect
    if (env.cornerRadius === undefined) {
      throw new Error('roundedRect envelope missing cornerRadius');
    }
    const r = env.cornerRadius;
    let cs;
    if (r > 1e-6) {
      const innerA = Math.max(1e-6, csX - 2 * r);
      const innerB = Math.max(1e-6, csY - 2 * r);
      cs = CrossSection.square([innerA, innerB], true).offset(
        r, 'Round', 2, CIRCULAR_SEGMENTS,
      );
    } else {
      cs = CrossSection.square([csX, csY], true);
    }
    // Extrude produces z∈(0, L). Shift down by L/2 so the prism is centered
    // at the origin — matches the cylinder branch and makes the post-rotation
    // translate axis-agnostic.
    m = cs.extrude(length).translate([0, 0, -length / 2]);
  }

  // Rotate so the prism's extrude axis aligns with the parting axis. Degrees.
  // Direction matches getRotationForAxis() in channelPlacement.ts so that the
  // mold-box rotation and the channel/pin rotation share a single convention.
  // (For centered prisms either ±90° gives the same AABB, but pinning the same
  // numbers in both places keeps the convention legible.)
  if (env.axis === 'x') m = m.rotate([0, 90, 0]);
  else if (env.axis === 'y') m = m.rotate([-90, 0, 0]);
  // axis === 'z' — already aligned.

  // Place the (origin-centered, rotated) manifold so its center coincides with
  // the envelope's AABB center. For cylinders, the lateral AABB center equals
  // the cylinder center by construction in computeMoldEnvelope.
  return m.translate([
    env.moldMin.x + env.moldSize.x / 2,
    env.moldMin.y + env.moldSize.y / 2,
    env.moldMin.z + env.moldSize.z / 2,
  ]);
}
