import React, { useRef } from 'react';
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
      <lineSegments geometry={new THREE.EdgesGeometry(geometry, 30)}>
        <lineBasicMaterial color={color} transparent opacity={0.15} />
      </lineSegments>
    </group>
  );
}
