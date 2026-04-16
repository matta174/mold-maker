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

/** Rotation (in DEGREES) to orient a default-Z cylinder along the given axis. */
export function getRotationForAxis(axis: Axis): [number, number, number] {
  switch (axis) {
    case 'x': return [0, 90, 0];
    case 'y': return [90, 0, 0];
    case 'z': return [0, 0, 0];
  }
}

/**
 * Compute sprue and vent positions using geometry analysis.
 *
 * Strategy:
 * - SPRUE: Analyze the part geometry to find the thickest cross-section in the
 *   "top" half (positive side of split). Gate at the thickest point ensures
 *   material flows thick→thin, reducing shrinkage voids. For gravity casting,
 *   placing the gate high lets gravity assist the fill.
 *
 * - VENTS: Find the extremity vertices in the top half that are farthest from
 *   the sprue. These are where air gets trapped last. Also add vents at any
 *   local high points (vertices with high values along the split axis).
 *
 * Manifold.cylinder() creates along Z by default, so we return a rotation
 * (in degrees) to orient the holes along the correct axis.
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
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);

  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const topFaceVal = moldMin.getComponent(axisIdx) + moldSize.getComponent(axisIdx);
  const sprueHeight = topFaceVal - splitPos;

  const positions = geometry.attributes.position.array;
  const vertCount = positions.length / 3;

  // ── Find optimal sprue position ──
  // Practical heuristic: centroid of all vertices in the top half. This
  // naturally gravitates toward the bulk of the part.
  let sumA = 0, sumB = 0, topCount = 0;

  const lateralA = (axisIdx + 1) % 3;
  const lateralB = (axisIdx + 2) % 3;

  for (let i = 0; i < vertCount; i++) {
    const splitVal = positions[i * 3 + axisIdx];
    if (splitVal >= splitPos) {
      sumA += positions[i * 3 + lateralA];
      sumB += positions[i * 3 + lateralB];
      topCount++;
    }
  }

  const centroidA = topCount > 0 ? sumA / topCount : center.getComponent(lateralA);
  const centroidB = topCount > 0 ? sumB / topCount : center.getComponent(lateralB);

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
      const dist = Math.sqrt((a - centroidA) ** 2 + (b - centroidB) ** 2);
      ventCandidates.push({ dist, a, b });
    }
  }

  ventCandidates.sort((x, y) => y.dist - x.dist);

  // Cluster the farthest points into distinct vent locations
  const ventPositions: [number, number, number][] = [];
  const minVentSpacing = Math.max(bboxSize.getComponent(lateralA), bboxSize.getComponent(lateralB)) * VENT_MIN_SPACING_RATIO;

  for (const candidate of ventCandidates) {
    if (ventPositions.length >= MAX_VENTS) break;

    const tooClose = ventPositions.some(vp => {
      const da = vp[lateralA] - candidate.a;
      const db = vp[lateralB] - candidate.b;
      return Math.sqrt(da * da + db * db) < minVentSpacing;
    });

    if (!tooClose) {
      const pos: [number, number, number] = [0, 0, 0];
      pos[axisIdx] = splitPos;
      pos[lateralA] = candidate.a;
      pos[lateralB] = candidate.b;
      ventPositions.push(pos);
    }
  }

  // Ensure at least MIN_VENTS vents: if clustering eliminated too many, add corners
  if (ventPositions.length < MIN_VENTS) {
    const corners: [number, number][] = [
      [bbox.min.getComponent(lateralA), bbox.min.getComponent(lateralB)],
      [bbox.max.getComponent(lateralA), bbox.max.getComponent(lateralB)],
      [bbox.min.getComponent(lateralA), bbox.max.getComponent(lateralB)],
      [bbox.max.getComponent(lateralA), bbox.min.getComponent(lateralB)],
    ];
    for (const [ca, cb] of corners) {
      if (ventPositions.length >= MIN_VENTS) break;
      const pos: [number, number, number] = [0, 0, 0];
      pos[axisIdx] = splitPos;
      pos[lateralA] = ca;
      pos[lateralB] = cb;
      ventPositions.push(pos);
    }
  }

  // Rotation to orient cylinders along the split axis (DEGREES — manifold-3d convention)
  let rotation: [number, number, number];
  switch (axis) {
    case 'z': rotation = [0, 0, 0]; break;
    case 'y': rotation = [90, 0, 0]; break;
    case 'x': rotation = [0, 90, 0]; break;
  }

  dbg(`Sprue at [${spruePos.map(v => v.toFixed(1))}], ${ventPositions.length} vents, height ${sprueHeight.toFixed(1)}`);

  return { spruePos, sprueHeight, ventPositions, rotation };
}
