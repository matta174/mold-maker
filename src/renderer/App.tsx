import { useState, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import ModelViewer from './components/ModelViewer';
import ControlPanel from './components/ControlPanel';
import PartingPlane from './components/PartingPlane';
import { useMoldGenerator, EXPLODE_OFFSET_RATIO } from './hooks/useMoldGenerator';
import { loadFile } from './utils/fileLoader';
import type { Axis } from './types';
import { colors, radii, spacing, fontSizes, focusVisibleCss } from './theme';
import { WALL_THICKNESS_RATIO, CLEARANCE_RATIO } from './mold/constants';

export type { Axis } from './types';

/**
 * Snapshot of the parameters a given mold was generated with. When the current
 * parameters drift from this snapshot, the UI knows the mold is stale and
 * surfaces a "Regenerate Mold" CTA instead of silently discarding the mold.
 */
export interface GeneratedParams {
  axis: Axis;
  offset: number;
  wallThicknessRatio: number;
  clearanceRatio: number;
}

export interface AppState {
  originalGeometry: THREE.BufferGeometry | null;
  fileName: string;
  axis: Axis;
  planeOffset: number;
  /** Wall thickness as a fraction of max bbox extent. User-tunable; defaults to constants. */
  wallThicknessRatio: number;
  /** Clearance between mating surfaces as a fraction of wall thickness. User-tunable. */
  clearanceRatio: number;
  autoDetecting: boolean;
  moldGenerated: boolean;
  topMold: THREE.BufferGeometry | null;
  bottomMold: THREE.BufferGeometry | null;
  /** Params used to generate the current mold — null when no mold exists. */
  generatedParams: GeneratedParams | null;
  explodedView: boolean;
  showOriginal: boolean;
  generating: boolean;
  boundingBox: THREE.Box3 | null;
  /** User-facing error message for load / generate / auto-detect failures. */
  errorMessage: string | null;
}

const initialState: AppState = {
  originalGeometry: null,
  fileName: '',
  axis: 'z',
  planeOffset: 0.5,
  wallThicknessRatio: WALL_THICKNESS_RATIO,
  clearanceRatio: CLEARANCE_RATIO,
  autoDetecting: false,
  moldGenerated: false,
  topMold: null,
  bottomMold: null,
  generatedParams: null,
  explodedView: true,
  showOriginal: true,
  generating: false,
  boundingBox: null,
  errorMessage: null,
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const { generateMold, exportFiles, autoDetectPlane } = useMoldGenerator();

  // ── Geometry disposal effects ──
  // Three.js BufferGeometry holds GPU-side vertex buffers that are NOT reclaimed
  // by the JS garbage collector. Each effect captures the current geometry and
  // disposes it when the dependency changes (React runs cleanup-of-previous
  // before running the new effect, so the outgoing geometry is released before
  // the incoming one renders).
  useEffect(() => {
    const g = state.originalGeometry;
    return () => { g?.dispose(); };
  }, [state.originalGeometry]);

  useEffect(() => {
    const g = state.topMold;
    return () => { g?.dispose(); };
  }, [state.topMold]);

  useEffect(() => {
    const g = state.bottomMold;
    return () => { g?.dispose(); };
  }, [state.bottomMold]);

  const handleFileLoad = useCallback(async () => {
    try {
      const result = await loadFile();
      if (!result) return;

      const { geometry, fileName } = result;
      geometry.computeBoundingBox();
      geometry.center();
      geometry.computeVertexNormals();

      const bbox = geometry.boundingBox!.clone();

      setState({
        ...initialState,
        originalGeometry: geometry,
        fileName,
        boundingBox: bbox,
        showOriginal: true,
      });
    } catch (err) {
      console.error('File load failed:', err);
      setState(prev => ({
        ...prev,
        errorMessage: err instanceof Error ? err.message : 'Failed to load file.',
      }));
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!state.originalGeometry || !state.boundingBox) return;
    // Concurrent-click guard: even though the button is disabled, an Enter-key
    // repeat or a synthetic click can re-enter before React rerenders. Manifold
    // WASM is a singleton — running two CSG graphs in parallel can corrupt it.
    if (state.generating) return;

    setState(prev => ({ ...prev, generating: true, errorMessage: null }));

    // Snapshot params at call time so the result we later commit is tagged
    // with the params actually used, even if the user changes them mid-flight.
    const params: GeneratedParams = {
      axis: state.axis,
      offset: state.planeOffset,
      wallThicknessRatio: state.wallThicknessRatio,
      clearanceRatio: state.clearanceRatio,
    };

    try {
      const result = await generateMold(
        state.originalGeometry,
        state.boundingBox,
        params.axis,
        params.offset,
        {
          wallThicknessRatio: params.wallThicknessRatio,
          clearanceRatio: params.clearanceRatio,
        },
      );

      setState(prev => ({
        ...prev,
        topMold: result.top,
        bottomMold: result.bottom,
        moldGenerated: true,
        generatedParams: params,
        generating: false,
        showOriginal: false,
      }));
    } catch (err) {
      console.error('Mold generation failed:', err);
      setState(prev => ({
        ...prev,
        generating: false,
        errorMessage: err instanceof Error
          ? err.message
          : 'Mold generation failed. The model may not be watertight.',
      }));
    }
  }, [
    state.originalGeometry, state.boundingBox,
    state.axis, state.planeOffset,
    state.wallThicknessRatio, state.clearanceRatio,
    state.generating, generateMold,
  ]);

  const handleAutoDetect = useCallback(async () => {
    if (!state.originalGeometry) return;
    if (state.autoDetecting) return;
    setState(prev => ({ ...prev, autoDetecting: true, errorMessage: null }));

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
      setState(prev => ({
        ...prev,
        autoDetecting: false,
        errorMessage: err instanceof Error ? err.message : 'Auto-detect failed.',
      }));
    }
  }, [state.originalGeometry, state.autoDetecting, autoDetectPlane]);

  const handleExport = useCallback(async (format: 'stl' | 'obj' | '3mf') => {
    if (!state.topMold || !state.bottomMold) return;
    try {
      await exportFiles(state.topMold, state.bottomMold, state.fileName, format);
    } catch (err) {
      console.error('Export failed:', err);
      setState(prev => ({
        ...prev,
        errorMessage: err instanceof Error ? err.message : 'Export failed.',
      }));
    }
  }, [state.topMold, state.bottomMold, state.fileName, exportFiles]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, errorMessage: null }));
  }, []);

  // Visual indicator of the current parting plane. Shown before first generation
  // OR after, when the user has moved the slider/axis away from the params the
  // current mold was generated with (so the indicator marks where the *next*
  // cut will happen, not the old one).
  const paramsChanged = state.generatedParams !== null && (
    state.generatedParams.axis !== state.axis ||
    state.generatedParams.offset !== state.planeOffset ||
    state.generatedParams.wallThicknessRatio !== state.wallThicknessRatio ||
    state.generatedParams.clearanceRatio !== state.clearanceRatio
  );
  const showPartingPlaneIndicator =
    !!state.originalGeometry && !!state.boundingBox && (!state.moldGenerated || paramsChanged);

  return (
    <>
      {/* One-time <style> injection for focus-visible rings. Inline styles
          can't express pseudo-classes, so any focusable element (button,
          input, etc.) gets a brand-colored ring via this rule. */}
      <style>{focusVisibleCss}</style>

      <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
        {/* 3D Viewport */}
        <main style={{ flex: 1, position: 'relative' }} aria-label="3D viewport">
          <Canvas
            camera={{ position: [80, 60, 80], fov: 50, near: 0.1, far: 10000 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
          >
            <color attach="background" args={[colors.viewportBg]} />
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

            {showPartingPlaneIndicator && (
              <PartingPlane
                axis={state.axis}
                offset={state.planeOffset}
                boundingBox={state.boundingBox!}
              />
            )}

            <OrbitControls makeDefault />
            <gridHelper args={[200, 20, colors.gridMajor, colors.gridMinor]} />

            <GizmoHelper alignment="bottom-left" margin={[60, 60]}>
              <GizmoViewport />
            </GizmoHelper>
          </Canvas>

          {/* Error banner: surface failures that previously only went to console */}
          {state.errorMessage && (
            <div
              role="alert"
              style={{
                position: 'absolute', top: spacing.lg, left: spacing.lg, right: spacing.lg,
                background: colors.errorBg, color: colors.textPrimary,
                padding: `${spacing.md}px ${spacing.lg}px`,
                borderRadius: radii.lg,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                fontSize: fontSizes.md,
                zIndex: 10,
              }}
            >
              <span>{state.errorMessage}</span>
              <button
                type="button"
                onClick={clearError}
                style={{
                  background: 'transparent', color: colors.textPrimary,
                  border: `1px solid ${colors.textPrimary}`,
                  borderRadius: radii.sm,
                  padding: `${spacing.xs}px ${spacing.sm + 2}px`,
                  cursor: 'pointer', fontSize: fontSizes.xs,
                  marginLeft: spacing.lg,
                }}
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Drop zone — real <button> so it's keyboard-focusable and screen
              readers announce it as an interactive element. */}
          {!state.originalGeometry && (
            <button
              type="button"
              onClick={handleFileLoad}
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', background: 'rgba(18, 24, 43, 0.85)',
                border: 'none', color: colors.textPrimary,
                fontFamily: 'inherit',
              }}
              aria-label="Load a 3D model file"
            >
              {/* Inline SVG instead of a platform-dependent emoji — renders
                  identically across macOS / Windows / Linux. */}
              <svg
                aria-hidden="true"
                width="64" height="64" viewBox="0 0 24 24"
                fill="none" stroke={colors.primary}
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ marginBottom: spacing.lg }}
              >
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <div style={{ fontSize: fontSizes.lg, fontWeight: 600 }}>Click to load a 3D model</div>
              <div style={{ fontSize: fontSizes.md, color: colors.textFaint, marginTop: spacing.sm }}>
                Supports STL and OBJ files
              </div>
            </button>
          )}
        </main>

        {/* Control Panel — axis/offset changes no longer wipe the mold; the
            Generate button relabels to "Regenerate Mold" when params drift. */}
        <ControlPanel
          state={state}
          onLoadFile={handleFileLoad}
          onAxisChange={(axis: Axis) => setState(prev => ({ ...prev, axis }))}
          onOffsetChange={(offset: number) => setState(prev => ({ ...prev, planeOffset: offset }))}
          onWallThicknessChange={(wallThicknessRatio: number) =>
            setState(prev => ({ ...prev, wallThicknessRatio }))}
          onClearanceChange={(clearanceRatio: number) =>
            setState(prev => ({ ...prev, clearanceRatio }))}
          onResetDimensions={() => setState(prev => ({
            ...prev,
            wallThicknessRatio: WALL_THICKNESS_RATIO,
            clearanceRatio: CLEARANCE_RATIO,
          }))}
          onGenerate={handleGenerate}
          onAutoDetect={handleAutoDetect}
          onExport={handleExport}
          onToggleExplode={() => setState(prev => ({ ...prev, explodedView: !prev.explodedView }))}
          onToggleOriginal={() => setState(prev => ({ ...prev, showOriginal: !prev.showOriginal }))}
          onStartOver={() => setState(initialState)}
        />
      </div>
    </>
  );
}

function getExplodeOffset(axis: Axis, direction: number, bbox: THREE.Box3): [number, number, number] {
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const dist = Math.max(size.x, size.y, size.z) * EXPLODE_OFFSET_RATIO;

  switch (axis) {
    case 'x': return [direction * dist, 0, 0];
    case 'y': return [0, direction * dist, 0];
    case 'z': return [0, 0, direction * dist];
  }
}
