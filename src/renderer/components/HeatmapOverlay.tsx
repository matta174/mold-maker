import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Axis } from '../types';
import { buildDraftHeatmapGeometry } from '../mold/draftAnalysis';

/**
 * Demoldability heatmap — a diagnostic view that paints the model by how
 * well each face will release from the mold given the current parting
 * plane. Green: faces the puller can grab easily. Yellow: near-vertical,
 * risk of sticking. Red: undercut, physically catches on the mold.
 *
 * This is the "see the storm coming" view — try a different axis or slide
 * the parting plane, watch the heatmap, and pick the setup that minimizes
 * red before committing to the CSG run.
 */
interface HeatmapOverlayProps {
  geometry: THREE.BufferGeometry;
  axis: Axis;
  offset: number;
  boundingBox: THREE.Box3;
}

export default function HeatmapOverlay({
  geometry,
  axis,
  offset,
  boundingBox,
}: HeatmapOverlayProps) {
  // Rebuild the colored geometry whenever inputs change. This is linear in
  // triangle count — ~a few ms for a 50k-face mesh — so it's fine on every
  // slider tick. If that ever becomes a bottleneck we can move it into a
  // worker or debounce here.
  const colored = useMemo(
    () => buildDraftHeatmapGeometry(geometry, axis, offset, boundingBox),
    [geometry, axis, offset, boundingBox],
  );

  // Dispose GPU buffers when the colored geometry is replaced or the
  // component unmounts — same pattern as ModelViewer's edges geometry.
  useEffect(() => () => colored.dispose(), [colored]);

  return (
    <mesh geometry={colored}>
      <meshBasicMaterial
        vertexColors
        side={THREE.DoubleSide}
        // Basic (unlit) material on purpose: lighting would tint the
        // classification colors and bury the signal. This is a diagnostic
        // view, not a beauty shot — the flat colors need to survive from
        // any viewing angle.
      />
    </mesh>
  );
}
