import { useMemo } from 'react';
import * as THREE from 'three';
import type { Axis } from '../types';

interface PartingPlaneProps {
  axis: Axis;
  offset: number; // 0-1 normalized
  boundingBox: THREE.Box3;
}

export default function PartingPlane({ axis, offset, boundingBox }: PartingPlaneProps) {
  const { position, rotation, size } = useMemo(() => {
    const bboxSize = new THREE.Vector3();
    const center = new THREE.Vector3();
    boundingBox.getSize(bboxSize);
    boundingBox.getCenter(center);

    const margin = 1.3;
    const planeW = Math.max(bboxSize.x, bboxSize.y, bboxSize.z) * margin;

    const min = boundingBox.min;
    const max = boundingBox.max;

    let pos: [number, number, number];
    let rot: [number, number, number];

    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const val = min.getComponent(axisIdx) + (max.getComponent(axisIdx) - min.getComponent(axisIdx)) * offset;

    switch (axis) {
      case 'x':
        pos = [val, center.y, center.z];
        rot = [0, Math.PI / 2, 0];
        break;
      case 'y':
        pos = [center.x, val, center.z];
        rot = [Math.PI / 2, 0, 0];
        break;
      case 'z':
      default:
        pos = [center.x, center.y, val];
        rot = [0, 0, 0];
        break;
    }

    return { position: pos, rotation: rot, size: planeW };
  }, [axis, offset, boundingBox]);

  return (
    <group position={position} rotation={rotation}>
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
