import React, { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import ModelViewer from './components/ModelViewer';
import ControlPanel from './components/ControlPanel';
import PartingPlane from './components/PartingPlane';
import { useMoldGenerator } from './hooks/useMoldGenerator';
import { loadFile } from './utils/fileLoader';

export type Axis = 'x' | 'y' | 'z';

export interface AppState {
  originalGeometry: THREE.BufferGeometry | null;
  fileName: string;
  axis: Axis;
  planeOffset: number;
  autoDetecting: boolean;
  moldGenerated: boolean;
  topMold: THREE.BufferGeometry | null;
  bottomMold: THREE.BufferGeometry | null;
  explodedView: boolean;
  showOriginal: boolean;
  generating: boolean;
  boundingBox: THREE.Box3 | null;
}

const initialState: AppState = {
  originalGeometry: null,
  fileName: '',
  axis: 'z',
  planeOffset: 0.5,
  autoDetecting: false,
  moldGenerated: false,
  topMold: null,
  bottomMold: null,
  explodedView: true,
  showOriginal: true,
  generating: false,
  boundingBox: null,
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const { generateMold, exportFiles, autoDetectPlane } = useMoldGenerator();

  const handleFileLoad = useCallback(async () => {
    const result = await loadFile();
    if (!result) return;

    const { geometry, fileName } = result;
    geometry.computeBoundingBox();
    geometry.center();
    geometry.computeVertexNormals();

    const bbox = geometry.boundingBox!.clone();

    setState(prev => ({
      ...initialState,
      originalGeometry: geometry,
      fileName,
      boundingBox: bbox,
      showOriginal: true,
    }));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!state.originalGeometry || !state.boundingBox) return;

    setState(prev => ({ ...prev, generating: true }));

    try {
      const result = await generateMold(
        state.originalGeometry,
        state.boundingBox,
        state.axis,
        state.planeOffset
      );

      setState(prev => ({
        ...prev,
        topMold: result.top,
        bottomMold: result.bottom,
        moldGenerated: true,
        generating: false,
        showOriginal: false,
      }));
    } catch (err) {
      console.error('Mold generation failed:', err);
      setState(prev => ({ ...prev, generating: false }));
    }
  }, [state.originalGeometry, state.boundingBox, state.axis, state.planeOffset, generateMold]);

  const handleAutoDetect = useCallback(async () => {
    if (!state.originalGeometry) return;
    setState(prev => ({ ...prev, autoDetecting: true }));

    try {
      const result = await autoDetectPlane(state.originalGeometry);
      setState(prev => ({
        ...prev,
        axis: result.axis,
        planeOffset: result.offset,
        autoDetecting: false,
      }));
    } catch (err) {
      console.error('Auto-detect failed:', err);
      setState(prev => ({ ...prev, autoDetecting: false }));
    }
  }, [state.originalGeometry, autoDetectPlane]);

  const handleExport = useCallback(async (format: 'stl' | 'obj' | '3mf') => {
    if (!state.topMold || !state.bottomMold) return;
    await exportFiles(state.topMold, state.bottomMold, state.fileName, format);
  }, [state.topMold, state.bottomMold, state.fileName, exportFiles]);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
      {/* 3D Viewport */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas
          camera={{ position: [80, 60, 80], fov: 50, near: 0.1, far: 10000 }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        >
          <color attach="background" args={['#1a1a2e']} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <directionalLight position={[-5, -5, -5]} intensity={0.3} />

          {state.originalGeometry && state.showOriginal && (
            <ModelViewer geometry={state.originalGeometry} color="#6c9bcf" opacity={state.moldGenerated ? 0.3 : 0.9} />
          )}

          {state.moldGenerated && state.topMold && (
            <ModelViewer
              geometry={state.topMold}
              color="#5b9bd5"
              opacity={0.85}
              position={state.explodedView ? getExplodeOffset(state.axis, 1, state.boundingBox!) : [0, 0, 0]}
            />
          )}

          {state.moldGenerated && state.bottomMold && (
            <ModelViewer
              geometry={state.bottomMold}
              color="#e07070"
              opacity={0.85}
              position={state.explodedView ? getExplodeOffset(state.axis, -1, state.boundingBox!) : [0, 0, 0]}
            />
          )}

          {state.originalGeometry && !state.moldGenerated && state.boundingBox && (
            <PartingPlane
              axis={state.axis}
              offset={state.planeOffset}
              boundingBox={state.boundingBox}
            />
          )}

          <OrbitControls makeDefault />
          <gridHelper args={[200, 20, '#333355', '#222244']} />

          <GizmoHelper alignment="bottom-left" margin={[60, 60]}>
            <GizmoViewport />
          </GizmoHelper>

          <Environment preset="studio" />
        </Canvas>

        {/* Drop zone overlay */}
        {!state.originalGeometry && (
          <div
            onClick={handleFileLoad}
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', background: 'rgba(26, 26, 46, 0.85)',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>Click to load a 3D model</div>
            <div style={{ fontSize: 14, color: '#888', marginTop: 8 }}>Supports STL and OBJ files</div>
          </div>
        )}
      </div>

      {/* Control Panel */}
      <ControlPanel
        state={state}
        onLoadFile={handleFileLoad}
        onAxisChange={(axis: Axis) => setState(prev => ({ ...prev, axis, moldGenerated: false, topMold: null, bottomMold: null, showOriginal: true }))}
        onOffsetChange={(offset: number) => setState(prev => ({ ...prev, planeOffset: offset, moldGenerated: false, topMold: null, bottomMold: null, showOriginal: true }))}
        onGenerate={handleGenerate}
        onAutoDetect={handleAutoDetect}
        onExport={handleExport}
        onToggleExplode={() => setState(prev => ({ ...prev, explodedView: !prev.explodedView }))}
        onToggleOriginal={() => setState(prev => ({ ...prev, showOriginal: !prev.showOriginal }))}
        onStartOver={() => setState(initialState)}
      />
    </div>
  );
}

function getExplodeOffset(axis: Axis, direction: number, bbox: THREE.Box3): [number, number, number] {
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const dist = Math.max(size.x, size.y, size.z) * 0.3;

  switch (axis) {
    case 'x': return [direction * dist, 0, 0];
    case 'y': return [0, direction * dist, 0];
    case 'z': return [0, 0, direction * dist];
  }
}
