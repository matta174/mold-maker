import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

interface ModelViewerProps {
  geometry: THREE.BufferGeometry;
  color?: string;
  opacity?: number;
  position?: [number, number, number];
  wireframe?: boolean;
}

export default function ModelViewer({
  geometry,
  color = '#6c9bcf',
  opacity = 0.9,
  position = [0, 0, 0],
  wireframe = false,
}: ModelViewerProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // EdgesGeometry is O(triangles) to compute. Previously it was built inline on
  // every render — now memoized against the source geometry, and disposed when
  // the source changes or the component unmounts so GPU buffers don't leak.
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 30), [geometry]);
  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <group position={position}>
      <mesh ref={meshRef} geometry={geometry}>
        <meshPhysicalMaterial
          color={color}
          transparent={opacity < 1}
          opacity={opacity}
          roughness={0.35}
          metalness={0.1}
          clearcoat={0.3}
          side={THREE.DoubleSide}
          wireframe={wireframe}
        />
      </mesh>
      {/* Edge highlight */}
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={color} transparent opacity={0.15} />
      </lineSegments>
    </group>
  );
}
