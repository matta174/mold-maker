import { useMemo } from 'react';
import * as THREE from 'three';
import type { Axis } from '../types';
import { getPlaneNormal } from '../mold/planeGeometry';

interface PartingPlaneProps {
  axis: Axis;
  offset: number; // 0-1 normalized
  boundingBox: THREE.Box3;
  /** Tilt of the parting plane around its hinge axis, degrees. 0 = axis-aligned. Optional for back-compat. */
  cutAngle?: number;
}

/**
 * Semi-transparent preview quad showing WHERE the mold will be cut. Must
 * match the CSG pipeline's plane exactly, otherwise the preview lies.
 *
 * Orientation: `<planeGeometry>` creates a quad in the XY plane (so its
 * default normal is +Z). We rotate it so that +Z maps to the actual parting
 * plane normal — using `Quaternion.setFromUnitVectors` which handles any
 * (from, to) pair without branching on axis or hinge direction. This keeps
 * the axis-aligned case (cutAngle=0) producing the same Eulers the old code
 * built by hand, and the tilted case "just works" by letting Three derive
 * the right rotation quaternion from the plane normal.
 */
export default function PartingPlane({
  axis,
  offset,
  boundingBox,
  cutAngle = 0,
}: PartingPlaneProps) {
  const { position, quaternion, size } = useMemo(() => {
    const bboxSize = new THREE.Vector3();
    const center = new THREE.Vector3();
    boundingBox.getSize(bboxSize);
    boundingBox.getCenter(center);

    const margin = 1.3;
    const planeW = Math.max(bboxSize.x, bboxSize.y, bboxSize.z) * margin;

    const min = boundingBox.min;
    const max = boundingBox.max;

    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const val = min.getComponent(axisIdx) + (max.getComponent(axisIdx) - min.getComponent(axisIdx)) * offset;

    // Pivot: centred laterally in the bbox at the current offset along the axis.
    // Matches the pivot used by `getPlaneEquation` so the visual preview rotates
    // around the same point as the CSG plane.
    let pos: [number, number, number];
    switch (axis) {
      case 'x':
        pos = [val, center.y, center.z];
        break;
      case 'y':
        pos = [center.x, val, center.z];
        break;
      case 'z':
      default:
        pos = [center.x, center.y, val];
        break;
    }

    // Plane normal from the math module — identical to what CSG uses.
    const n = getPlaneNormal(axis, cutAngle);
    const planeNormal = new THREE.Vector3(n[0], n[1], n[2]);
    // planeGeometry's local +Z points "out of the page". Rotate that local Z
    // to the target plane normal. For axis='z', cutAngle=0 this returns the
    // identity quaternion → equivalent to the legacy rot=[0,0,0].
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      planeNormal,
    );

    return { position: pos, quaternion: q, size: planeW };
  }, [axis, offset, boundingBox, cutAngle]);

  return (
    <group position={position} quaternion={quaternion}>
      <mesh>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial
          color="#ff6b35"
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Border */}
      <lineLoop>
        <bufferGeometry>
          {/* R3F's JSX typings for bufferAttribute require `args` — the
              constructor-tuple form (array, itemSize). Older code passed
              count/array/itemSize as individual props; newer @types/three
              + @react-three/fiber enforce the tuple shape. */}
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array([
                -size / 2, -size / 2, 0,
                size / 2, -size / 2, 0,
                size / 2, size / 2, 0,
                -size / 2, size / 2, 0,
              ]),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#ff6b35" opacity={0.6} transparent />
      </lineLoop>
    </group>
  );
}
