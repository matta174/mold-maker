import * as THREE from 'three';
import type { Axis, MoldBoxShape } from '../types';
import {
  WALL_THICKNESS_RATIO,
  CLEARANCE_RATIO,
  PIN_RADIUS_RATIO,
  PIN_HEIGHT_RATIO,
  EST_WALL_THICKNESS_RATIO,
  SPRUE_GATE_TO_WALL,
  SPRUE_TOP_MULTIPLIER,
  VENT_RADIUS_RATIO,
  VENT_TAPER_RATIO,
  ENABLE_OBLIQUE_PLANES,
} from './constants';
import { clampCutAngle, getPlaneEquation } from './planeGeometry';
import {
  getManifold,
  geometryToManifold,
  manifoldToGeometry,
} from './manifoldBridge';
import {
  getRegistrationPinPositionsForEnvelope,
  getRotationForAxis,
  computeChannelPositionsForEnvelope,
} from './channelPlacement';
import { computeMoldEnvelope, createMoldBoxManifold } from './moldBox';

/**
 * Optional overrides for tunables that are otherwise read from ./constants.
 * Any field left undefined falls back to the module-level constant — so
 * existing call sites keep working without churn.
 */
export interface GenerateMoldOptions {
  /** Wall thickness as a fraction of max bbox extent. Defaults to WALL_THICKNESS_RATIO. */
  wallThicknessRatio?: number;
  /** Clearance between mating surfaces as a fraction of wall thickness. Defaults to CLEARANCE_RATIO. */
  clearanceRatio?: number;
  /** Outer shell shape. Defaults to 'rect' for backwards compatibility. */
  moldBoxShape?: MoldBoxShape;
  /**
   * Tilt of the parting plane around its hinge axis, in degrees.
   * 0 = axis-aligned (legacy behaviour). Range: [-30, 30]; anything
   * outside is clamped. Defaults to 0. Ignored while
   * ENABLE_OBLIQUE_PLANES is false — silently treated as 0.
   */
  cutAngle?: number;
  /**
   * Optional user-specified lateral sprue position. When provided, the
   * automatic centroid-and-snap placement is skipped and the sprue is
   * planted at these lateral coords (primary-axis coord is still lifted
   * onto the parting plane). Cavity verification is NOT performed — the
   * user's choice wins. See `computeChannelPositions` for full semantics.
   */
  sprueOverride?: { a: number; b: number };
}

/**
 * Pure CSG pipeline: given a part geometry and a split plane, produce the
 * two mold halves. No React, no DOM — exists as a standalone function so it
 * can run inside a Web Worker (P1) or be called directly from the main thread.
 *
 * Notes:
 *   • Manifold WASM is a singleton inside whatever context loads it (main
 *     thread or worker). It's NOT safe to run multiple generateMold calls
 *     concurrently in the same context.
 *   • Throws if Manifold can't form a valid manifold from the input mesh
 *     (usually means non-watertight geometry).
 */
export async function generateMold(
  geometry: THREE.BufferGeometry,
  boundingBox: THREE.Box3,
  axis: Axis,
  offset: number, // 0-1 normalized
  options: GenerateMoldOptions = {},
): Promise<{ top: THREE.BufferGeometry; bottom: THREE.BufferGeometry }> {
  const wasm = await getManifold();
  const { Manifold } = wasm;

  // Resolve option overrides against module defaults. `??` (not `||`) so that
  // an explicit 0 isn't silently replaced with the default — a 0 ratio is
  // nonsensical for wall thickness but we let downstream CSG fail loudly
  // rather than hide the bad input here.
  const wallThicknessRatio = options.wallThicknessRatio ?? WALL_THICKNESS_RATIO;
  const clearanceRatio = options.clearanceRatio ?? CLEARANCE_RATIO;
  const moldBoxShape: MoldBoxShape = options.moldBoxShape ?? 'rect';

  // cutAngle: accepted in the API for forward compat but force-zeroed until
  // the feature flag flips. Once ENABLE_OBLIQUE_PLANES is true this feeds
  // into the plane-equation helper used by the CSG / channel / heatmap paths.
  // Clamp defensively — user-facing UI clamps too, but the worker protocol
  // allows arbitrary values and we'd rather fail soft than CSG-fail hard.
  const cutAngle = ENABLE_OBLIQUE_PLANES ? clampCutAngle(options.cutAngle ?? 0) : 0;

  // Compute actual split position
  const bboxSize = new THREE.Vector3();
  const bboxMin = boundingBox.min.clone();
  const bboxMax = boundingBox.max.clone();
  boundingBox.getSize(bboxSize);

  // Defensive: a zero-extent bbox along any axis means the input is flat or
  // malformed. Downstream code (offsetFromSplitPos, wall-thickness math) would
  // silently treat this as "0 along that axis" and produce nonsense. Fail loud
  // with a message the UI error path can surface verbatim rather than hiding
  // behind a generic CSG failure later.
  if (bboxSize.x <= 0 || bboxSize.y <= 0 || bboxSize.z <= 0) {
    throw new Error(
      `Cannot generate mold: input bounding box is degenerate ` +
      `(size = [${bboxSize.x}, ${bboxSize.y}, ${bboxSize.z}]). ` +
      `The model may be flat or malformed.`,
    );
  }

  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const splitPos = bboxMin.getComponent(axisIdx) +
    (bboxMax.getComponent(axisIdx) - bboxMin.getComponent(axisIdx)) * offset;

  // Wall thickness and clearance (scale-relative, not absolute)
  const maxExtent = Math.max(bboxSize.x, bboxSize.y, bboxSize.z);
  const wallThickness = maxExtent * wallThicknessRatio;
  const clearance = wallThickness * clearanceRatio;

  // Mold outer envelope — shape-aware. AABB fields are still used by the
  // channel placement below (it reasons about the bounding region, not the
  // shell silhouette). For non-rect shapes, the envelope's AABB is the
  // circumscribing box of the actual shell.
  const envelope = computeMoldEnvelope(boundingBox, moldBoxShape, axis, wallThickness);

  // Convert the model to a Manifold
  let modelManifold;
  try {
    modelManifold = geometryToManifold(wasm, geometry);
  } catch (e) {
    console.error('Failed to create manifold from geometry:', e);
    throw new Error('Could not convert geometry to manifold. The model may not be watertight.');
  }

  // Create the full mold box (rect / cylinder / roundedRect)
  const fullBox = createMoldBoxManifold(wasm, envelope);

  // Subtract the model from the box to get the mold cavity
  const moldCavity = fullBox.subtract(modelManifold);

  // Split the cavity into top and bottom halves along the parting plane.
  //
  // Prior implementation: construct two giant AABB "cutter boxes" (one for
  // each side) with a tiny planeEpsilon overlap to avoid zero-size boxes at
  // offset=0 or 1, then intersect. That approach is impossible to extend to
  // oblique planes without rotating the cutters — fiddly and error-prone.
  //
  // Current implementation: Manifold.splitByPlane(normal, originOffset)
  // returns [above, below] directly, for any unit normal. For cutAngle=0 the
  // plane normal is the axis unit vector and originOffset is the old splitPos,
  // so the result is equivalent to the legacy cutter-box intersect. The
  // "above" half is the side the normal points toward (our top half).
  const plane = getPlaneEquation(
    [bboxMin.x, bboxMin.y, bboxMin.z],
    [bboxMax.x, bboxMax.y, bboxMax.z],
    axis, offset, cutAngle,
  );
  const [topHalf, bottomHalf] = moldCavity.splitByPlane(
    plane.normal as [number, number, number],
    plane.originOffset,
  );

  // Add registration pins/keys to help alignment
  const pinRadius = wallThickness * PIN_RADIUS_RATIO;
  const pinHeight = wallThickness * PIN_HEIGHT_RATIO;
  const pinPositions = getRegistrationPinPositionsForEnvelope(envelope, boundingBox, splitPos, cutAngle);

  let topResult = topHalf;
  let bottomResult = bottomHalf;

  for (const pinPos of pinPositions) {
    // Registration pins MUST span the parting plane: half inside the top
    // mold's solid body (the `add` is a no-op there — there's already
    // material) and half protruding into the bottom mold's region (where
    // `add` extends the top mold by a small cylindrical nub). The bottom
    // mold then subtracts a slightly larger clearance cylinder at the same
    // centered position, creating a matching socket.
    //
    // Pre-2026-04 the cylinders were built non-centered, so pins extended
    // entirely in the +parting-axis direction from splitPos. Both the `add`
    // and the `subtract` were no-ops for axis='z' and axis='x' (everything
    // happened inside the top mold's own body). Axis='y' accidentally worked
    // because a separate rotation-direction bug flipped its cylinders into
    // the bottom mold — fixing that bug exposed the fact that pins weren't
    // doing anything on any axis. The `true` center flag below is the fix.
    const pin = Manifold.cylinder(pinHeight, pinRadius, pinRadius, 16, true)
      .rotate(getRotationForAxis(axis)) // NOTE: manifold-3d's .rotate() takes DEGREES
      .translate(pinPos);

    topResult = topResult.add(pin);
    bottomResult = bottomResult.subtract(
      Manifold.cylinder(
        pinHeight + clearance * 2,
        pinRadius + clearance,
        pinRadius + clearance,
        16,
        true, // centered — must match the pin it clears for
      )
        .rotate(getRotationForAxis(axis))
        .translate(pinPos),
    );
  }

  // ── Pour sprue, runner, gate, and vent system ──
  //
  // Engineering principles (from injection molding & casting best practices):
  //
  // SPRUE: Tapered funnel from outer surface into the mold. Gate diameter
  //   should be ~1.5x the thickest wall section. Conservative taper since
  //   these are cast, not injected.
  //
  // GATE: Where sprue meets cavity. Placed at the thickest section so
  //   material flows thick→thin (reduces shrinkage voids). For gravity
  //   casting, placed high so material flows down.
  //
  // VENTS: Placed at highest points and extremities of the cavity —
  //   wherever air would get trapped last as material fills. For a two-part
  //   mold, vents go at points farthest from the gate AND at local high points.
  //
  // SIZING: Sprue gate ~1.5x estimated wall thickness. Vents much smaller
  //   (enough for air, not material leakage). Sprue tapers wider at top.

  const estWallThickness = Math.min(bboxSize.x, bboxSize.y, bboxSize.z) * EST_WALL_THICKNESS_RATIO;
  const sprueGateRadius = Math.max(estWallThickness * SPRUE_GATE_TO_WALL, wallThickness * 0.25);
  const sprueTopRadius = sprueGateRadius * SPRUE_TOP_MULTIPLIER;
  const ventRadius = sprueGateRadius * VENT_RADIUS_RATIO;

  // Clearance margins: how much material must remain between each channel's
  // outer radius and the shell's outer wall. Without these, the sprue and
  // vents can CSG-subtract through the side of the mold — producing visible
  // "pour hole drilled through the side" artifacts on cylinder molds, and
  // sometimes a degenerate empty manifold after the subtract.
  //
  // Biased asymmetric: the sprue gets a bigger safety wall (0.5× wall) than
  // vents (0.3× wall) because the sprue is the larger hole and the visible
  // one — a small vent punching a tiny scar near an extremity is more
  // forgivable than the pour spout doing the same. These ratios are
  // empirical: large enough to avoid visible wall breakouts on curved
  // cylinders at the default WALL_THICKNESS_RATIO, small enough that
  // channels still land near the part's actual thickest section and
  // extremities on typical geometry.
  const sprueMargin = sprueTopRadius + wallThickness * 0.5;
  const ventMargin = ventRadius + wallThickness * 0.3;

  const channels = computeChannelPositionsForEnvelope(
    envelope, boundingBox, splitPos, geometry,
    { sprueMargin, ventMargin },
    cutAngle,
    options.sprueOverride ? { sprueOverride: options.sprueOverride } : {},
  );

  // Guard against degenerate sprue heights. If the parting plane is pushed
  // all the way to the top of the bbox (offset ≈ 1), sprueHeight shrinks to
  // just wallThickness — and if it ever drops below a quarter of that, the
  // tapered cylinder becomes numerically unstable and the subtract can
  // collapse the top half to an empty manifold. Skip channels in that case
  // rather than produce a useless mold. Users get a clear "move the parting
  // plane" hint via the EmptyManifoldError surfaced from manifoldToGeometry
  // if the split is even more extreme than that.
  const MIN_CHANNEL_HEIGHT = wallThickness * 0.25;
  const channelsViable = channels.sprueHeight >= MIN_CHANNEL_HEIGHT;

  if (channelsViable) {
    // Sprue: tapered cylinder — wider at pour end, narrower at cavity
    const sprue = Manifold.cylinder(
      channels.sprueHeight,
      sprueGateRadius,
      sprueTopRadius,
      24,
    ).rotate(channels.rotation).translate(channels.spruePos);

    topResult = topResult.subtract(sprue);

    // Vent holes at extremities and high points
    for (const ventPos of channels.ventPositions) {
      const vent = Manifold.cylinder(
        channels.sprueHeight,
        ventRadius,
        ventRadius * VENT_TAPER_RATIO,
        12,
      ).rotate(channels.rotation).translate(ventPos);

      topResult = topResult.subtract(vent);
    }
  }

  const topGeo = manifoldToGeometry(topResult);
  const bottomGeo = manifoldToGeometry(bottomResult);

  return { top: topGeo, bottom: bottomGeo };
}

/**
 * Auto-detect the best parting plane by analyzing the geometry.
 * Tests multiple axis/offset combos and picks the one with the most balanced split.
 *
 * Pure function — no CSG, no WASM. Fast enough to stay on the main thread.
 */
export async function autoDetectPlane(
  geometry: THREE.BufferGeometry,
): Promise<{ axis: Axis; offset: number }> {
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);

  const positions = geometry.attributes.position.array;
  const vertCount = positions.length / 3;

  let bestAxis: Axis = 'z';
  let bestOffset = 0.5;
  let bestScore = -Infinity;

  const axes: Axis[] = ['x', 'y', 'z'];
  const steps = 20;

  for (const axis of axes) {
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const min = bbox.min.getComponent(axisIdx);
    const max = bbox.max.getComponent(axisIdx);
    const range = max - min;

    for (let s = 1; s < steps; s++) {
      const offset = s / steps;
      const splitVal = min + range * offset;

      // Count vertices above and below
      let above = 0;
      let below = 0;
      for (let i = 0; i < vertCount; i++) {
        const v = positions[i * 3 + axisIdx];
        if (v >= splitVal) above++;
        else below++;
      }

      // Score: balance (50/50 split is ideal) + prefer Z axis (gravity)
      const total = above + below;
      const balance = 1 - Math.abs(above - below) / total;

      // Penalize extreme positions
      const centeredness = 1 - Math.abs(offset - 0.5) * 2;

      // Slight preference for Z axis (conventional mold orientation)
      const axisPref = axis === 'z' ? 0.05 : 0;

      // Prefer the axis with the largest extent (more room for the mold)
      const extentNorm = range / Math.max(bboxSize.x, bboxSize.y, bboxSize.z);

      const score = balance * 0.6 + centeredness * 0.2 + axisPref + extentNorm * 0.15;

      if (score > bestScore) {
        bestScore = score;
        bestAxis = axis;
        bestOffset = offset;
      }
    }
  }

  return { axis: bestAxis, offset: bestOffset };
}
