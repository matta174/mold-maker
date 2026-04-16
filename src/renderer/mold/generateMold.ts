import * as THREE from 'three';
import type { Axis } from '../types';
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
} from './constants';
import {
  getManifold,
  geometryToManifold,
  manifoldToGeometry,
  createBox,
} from './manifoldBridge';
import {
  getRegistrationPinPositions,
  getRotationForAxis,
  computeChannelPositions,
} from './channelPlacement';

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

  // Compute actual split position
  const bboxSize = new THREE.Vector3();
  const bboxMin = boundingBox.min.clone();
  const bboxMax = boundingBox.max.clone();
  boundingBox.getSize(bboxSize);

  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const splitPos = bboxMin.getComponent(axisIdx) +
    (bboxMax.getComponent(axisIdx) - bboxMin.getComponent(axisIdx)) * offset;

  // Wall thickness and clearance (scale-relative, not absolute)
  const maxExtent = Math.max(bboxSize.x, bboxSize.y, bboxSize.z);
  const wallThickness = maxExtent * wallThicknessRatio;
  const clearance = wallThickness * clearanceRatio;

  // Cutter-plane fudge: prevents zero-size boxes when offset is exactly 0 or 1.
  // Scale-relative so it works for models measured in microns or meters.
  const planeEpsilon = maxExtent * 1e-6;

  // Mold outer box dimensions
  const moldSize = new THREE.Vector3(
    bboxSize.x + wallThickness * 2,
    bboxSize.y + wallThickness * 2,
    bboxSize.z + wallThickness * 2,
  );

  const moldMin = new THREE.Vector3(
    bboxMin.x - wallThickness,
    bboxMin.y - wallThickness,
    bboxMin.z - wallThickness,
  );

  // Convert the model to a Manifold
  let modelManifold;
  try {
    modelManifold = geometryToManifold(wasm, geometry);
  } catch (e) {
    console.error('Failed to create manifold from geometry:', e);
    throw new Error('Could not convert geometry to manifold. The model may not be watertight.');
  }

  // Create the full mold box
  const fullBox = createBox(wasm,
    moldSize.x, moldSize.y, moldSize.z,
    moldMin.x, moldMin.y, moldMin.z,
  );

  // Subtract the model from the box to get the mold cavity
  const moldCavity = fullBox.subtract(modelManifold);

  // Now split the cavity into top and bottom halves using cutting planes
  let topCutSize: [number, number, number];
  let topCutOffset: [number, number, number];
  let bottomCutSize: [number, number, number];
  let bottomCutOffset: [number, number, number];

  const bigExtent = maxExtent * 2 + wallThickness * 2;

  switch (axis) {
    case 'x':
      topCutSize = [moldMin.x + moldSize.x - splitPos + planeEpsilon, bigExtent, bigExtent];
      topCutOffset = [splitPos, moldMin.y - bigExtent / 4, moldMin.z - bigExtent / 4];
      bottomCutSize = [splitPos - moldMin.x + planeEpsilon, bigExtent, bigExtent];
      bottomCutOffset = [moldMin.x, moldMin.y - bigExtent / 4, moldMin.z - bigExtent / 4];
      break;
    case 'y':
      topCutSize = [bigExtent, moldMin.y + moldSize.y - splitPos + planeEpsilon, bigExtent];
      topCutOffset = [moldMin.x - bigExtent / 4, splitPos, moldMin.z - bigExtent / 4];
      bottomCutSize = [bigExtent, splitPos - moldMin.y + planeEpsilon, bigExtent];
      bottomCutOffset = [moldMin.x - bigExtent / 4, moldMin.y, moldMin.z - bigExtent / 4];
      break;
    case 'z':
    default:
      topCutSize = [bigExtent, bigExtent, moldMin.z + moldSize.z - splitPos + planeEpsilon];
      topCutOffset = [moldMin.x - bigExtent / 4, moldMin.y - bigExtent / 4, splitPos];
      bottomCutSize = [bigExtent, bigExtent, splitPos - moldMin.z + planeEpsilon];
      bottomCutOffset = [moldMin.x - bigExtent / 4, moldMin.y - bigExtent / 4, moldMin.z];
      break;
  }

  const topCutter = createBox(wasm, ...topCutSize, ...topCutOffset);
  const bottomCutter = createBox(wasm, ...bottomCutSize, ...bottomCutOffset);

  // Intersect to get each half
  const topHalf = moldCavity.intersect(topCutter);
  const bottomHalf = moldCavity.intersect(bottomCutter);

  // Add registration pins/keys to help alignment
  const pinRadius = wallThickness * PIN_RADIUS_RATIO;
  const pinHeight = wallThickness * PIN_HEIGHT_RATIO;
  const pinPositions = getRegistrationPinPositions(boundingBox, axis, splitPos, wallThickness);

  let topResult = topHalf;
  let bottomResult = bottomHalf;

  for (const pinPos of pinPositions) {
    const pin = Manifold.cylinder(pinHeight, pinRadius, pinRadius, 16)
      .rotate(getRotationForAxis(axis)) // NOTE: manifold-3d's .rotate() takes DEGREES
      .translate(pinPos);

    // Add pin to one half, subtract from the other
    topResult = topResult.add(pin);
    bottomResult = bottomResult.subtract(
      Manifold.cylinder(pinHeight + clearance * 2, pinRadius + clearance, pinRadius + clearance, 16)
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

  const channels = computeChannelPositions(
    boundingBox, axis, splitPos, moldMin, moldSize, geometry,
  );

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
