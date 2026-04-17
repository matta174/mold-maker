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
 * Create the Manifold representing the solid outer shell of the mold (before
 * the part cavity and channels are subtracted).
 *
 * Implementation notes:
 *   - Cylinder uses Manifold.cylinder directly. Its native axis is +Z, so we
 *     translate to put its base at the correct min-Z, then rotate if the
 *     parting axis is X or Y. Rotation is in degrees (manifold-3d convention).
 *   - RoundedRect builds a 2D cross-section with CrossSection.square +
 *     offset(cornerRadius, 'Round'), then extrudes along +Z, then rotates
 *     into the parting-axis frame. We use offset rather than chaining four
 *     corner squares + circles because Clipper2's 'Round' join does the
 *     work for us cleanly.
 */
export function createMoldBoxManifold(wasm: any, env: MoldEnvelope): any {
  const { Manifold, CrossSection } = wasm;

  if (env.shape === 'rect') {
    return Manifold.cube(
      [env.moldSize.x, env.moldSize.y, env.moldSize.z],
      false,
    ).translate([env.moldMin.x, env.moldMin.y, env.moldMin.z]);
  }

  if (env.shape === 'cylinder') {
    if (env.cylinderRadius === undefined) {
      throw new Error('cylinder envelope missing cylinderRadius');
    }
    const primary = primaryAxisIndex(env.axis);
    const lengthAlongAxis = env.moldSize.getComponent(primary);
    const minAlongAxis = env.moldMin.getComponent(primary);

    // Build the cylinder along +Z, then rotate so its axis aligns with the
    // parting axis. Finally translate so its base sits at the correct min.
    let m = Manifold.cylinder(
      lengthAlongAxis,
      env.cylinderRadius,
      env.cylinderRadius,
      CIRCULAR_SEGMENTS,
      false, // not centered — base at z=0
    );

    // rotate(axisFrame) — DEGREES, matches getRotationForAxis conventions in
    // channelPlacement.ts.
    if (env.axis === 'x') m = m.rotate([0, 90, 0]);
    else if (env.axis === 'y') m = m.rotate([90, 0, 0]);
    // else axis === 'z' — already aligned.

    // After rotation the cylinder's base sits at origin along the rotated axis,
    // centered at origin in the other two axes. Translate so its AABB matches
    // env.moldMin/moldSize.
    const translation: [number, number, number] = [0, 0, 0];
    translation[primary] = minAlongAxis;
    const [latA, latB] = lateralAxisIndices(env.axis);
    translation[latA] = env.cylinderCenterLatA ?? 0;
    translation[latB] = env.cylinderCenterLatB ?? 0;

    return m.translate(translation);
  }

  // roundedRect
  if (env.cornerRadius === undefined) {
    throw new Error('roundedRect envelope missing cornerRadius');
  }
  const primary = primaryAxisIndex(env.axis);
  const [latA, latB] = lateralAxisIndices(env.axis);
  const latSizeA = env.moldSize.getComponent(latA);
  const latSizeB = env.moldSize.getComponent(latB);
  const lengthAlongAxis = env.moldSize.getComponent(primary);

  // 2D cross-section: a rectangle of (latSizeA - 2r) × (latSizeB - 2r) inflated
  // by r with Round joins — produces a rounded rectangle. If cornerRadius is
  // zero or tiny, fall back to a plain square (offset(0) is a no-op).
  const r = env.cornerRadius;
  let cs;
  if (r > 1e-6) {
    const innerA = Math.max(1e-6, latSizeA - 2 * r);
    const innerB = Math.max(1e-6, latSizeB - 2 * r);
    cs = CrossSection.square([innerA, innerB], true).offset(
      r, 'Round', 2, CIRCULAR_SEGMENTS,
    );
  } else {
    cs = CrossSection.square([latSizeA, latSizeB], true);
  }

  // Extrude along +Z. The resulting Manifold is centered at (0,0) in XY and
  // extends from z=0 to z=lengthAlongAxis.
  let m = cs.extrude(lengthAlongAxis);

  if (env.axis === 'x') m = m.rotate([0, 90, 0]);
  else if (env.axis === 'y') m = m.rotate([90, 0, 0]);

  // Translate so the extruded prism matches env.moldMin.
  // Center of the prism's cross-section in world coords = center of AABB
  // perpendicular to the parting axis.
  const translation: [number, number, number] = [0, 0, 0];
  translation[primary] = env.moldMin.getComponent(primary);
  translation[latA] = env.moldMin.getComponent(latA) + latSizeA / 2;
  translation[latB] = env.moldMin.getComponent(latB) + latSizeB / 2;

  return m.translate(translation);
}
