import { useState, useCallback, useEffect, Fragment } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import ModelViewer from './components/ModelViewer';
import ControlPanel from './components/ControlPanel';
import PartingPlane from './components/PartingPlane';
import HeatmapOverlay from './components/HeatmapOverlay';
import { useMoldGenerator, EXPLODE_OFFSET_RATIO } from './hooks/useMoldGenerator';
import { loadFile, parseFile } from './utils/fileLoader';
import { createSampleModel } from './utils/sampleModel';
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
  /** Demoldability heatmap overlay — off by default (diagnostic view). */
  showHeatmap: boolean;
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
  showHeatmap: false,
  generating: false,
  boundingBox: null,
  errorMessage: null,
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  /**
   * Cheat-sheet overlay visibility. Pure UI ephemeral state — doesn't need
   * to survive anything, doesn't need to flow through ControlPanel, so it
   * lives outside AppState.
   */
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
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

  /**
   * Commit a freshly-parsed geometry to app state. Shared between the
   * file-picker, drag-drop, and sample-model entry points so all three
   * go through identical normalization (center, bbox, vertex normals)
   * and identical state-reset semantics. Wrapping this once avoids the
   * three-way drift that would otherwise appear the first time someone
   * "fixes" a bug in just one code path.
   */
  const commitGeometry = useCallback((
    geometry: THREE.BufferGeometry,
    fileName: string,
  ) => {
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
  }, []);

  const handleFileLoad = useCallback(async () => {
    try {
      const result = await loadFile();
      if (!result) return;
      commitGeometry(result.geometry, result.fileName);
    } catch (err) {
      console.error('File load failed:', err);
      setState(prev => ({
        ...prev,
        errorMessage: err instanceof Error ? err.message : 'Failed to load file.',
      }));
    }
  }, [commitGeometry]);

  const handleLoadSample = useCallback(() => {
    try {
      const { geometry, fileName } = createSampleModel();
      commitGeometry(geometry, fileName);
    } catch (err) {
      console.error('Sample load failed:', err);
      setState(prev => ({
        ...prev,
        errorMessage: err instanceof Error ? err.message : 'Failed to load sample.',
      }));
    }
  }, [commitGeometry]);

  /**
   * Drag-and-drop handler. We only accept a single file — dropping a
   * folder or multiple files takes the first file and surfaces an error
   * if the extension doesn't match. The browser's drag-drop File object
   * is identical to the one from <input type=file>, so we reuse parseFile.
   */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const result = await parseFile(file);
      commitGeometry(result.geometry, result.fileName);
    } catch (err) {
      console.error('Drop-load failed:', err);
      setState(prev => ({
        ...prev,
        errorMessage: err instanceof Error ? err.message : 'Failed to load dropped file.',
      }));
    }
  }, [commitGeometry]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Must preventDefault on *both* dragover and drop to opt out of the
    // browser default (navigate to the file). Missing dragover silently
    // makes drop a no-op and is a classic drag-drop gotcha.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
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

  // ── Global keyboard shortcuts ──
  // Installed once per relevant-state change. The skip-if-in-input check is
  // critical: without it, hitting "X" while focused on the plane-position
  // slider would try to jump to X-axis *and* nudge the slider. Range inputs
  // in particular use arrow keys, so we want zero interception while one is
  // focused.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't steal keystrokes from focused form controls.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) return;
      }
      // Don't interfere with browser/OS chords — Cmd-R reload, Ctrl-F find, etc.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ? (or Shift+/) toggles the cheat sheet. Escape always closes it.
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShortcutHelpOpen(v => !v);
        return;
      }
      if (e.key === 'Escape' && shortcutHelpOpen) {
        e.preventDefault();
        setShortcutHelpOpen(false);
        return;
      }
      // Suppress other shortcuts while the overlay is open — the overlay
      // reads like a dialog and shouldn't be acting on background shortcuts.
      if (shortcutHelpOpen) return;

      switch (e.key.toLowerCase()) {
        case 'o':
          e.preventDefault();
          handleFileLoad();
          break;
        case 'g':
          if (state.originalGeometry && !state.generating) {
            e.preventDefault();
            handleGenerate();
          }
          break;
        case 'a':
          if (state.originalGeometry && !state.autoDetecting) {
            e.preventDefault();
            handleAutoDetect();
          }
          break;
        case 'h':
          if (state.originalGeometry) {
            e.preventDefault();
            setState(prev => ({ ...prev, showHeatmap: !prev.showHeatmap }));
          }
          break;
        case 'e':
          if (state.moldGenerated) {
            e.preventDefault();
            setState(prev => ({ ...prev, explodedView: !prev.explodedView }));
          }
          break;
        case 'x':
        case 'y':
        case 'z':
          if (state.originalGeometry) {
            e.preventDefault();
            setState(prev => ({ ...prev, axis: e.key.toLowerCase() as Axis }));
          }
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    shortcutHelpOpen,
    state.originalGeometry, state.generating, state.autoDetecting, state.moldGenerated,
    handleFileLoad, handleGenerate, handleAutoDetect,
  ]);

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
        <main
          style={{ flex: 1, position: 'relative' }}
          aria-label="3D viewport"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <Canvas
            camera={{ position: [80, 60, 80], fov: 50, near: 0.1, far: 10000 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
          >
            <color attach="background" args={[colors.viewportBg]} />
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <directionalLight position={[-5, -5, -5]} intensity={0.3} />

            {/* Heatmap takes precedence over the normal original mesh — both
                at the same coordinates would Z-fight and the flat unlit
                heatmap colors would fight the lit physical material. */}
            {state.originalGeometry && state.boundingBox && state.showHeatmap && (
              <HeatmapOverlay
                geometry={state.originalGeometry}
                axis={state.axis}
                offset={state.planeOffset}
                boundingBox={state.boundingBox}
              />
            )}

            {state.originalGeometry && !state.showHeatmap && state.showOriginal && (
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

          {/* Heatmap legend — only visible when the heatmap is on. Positioned
              bottom-right to stay clear of the axis gizmo (bottom-left) and
              the error banner (top). Small, unobtrusive, explains what the
              colors mean so users don't have to guess. */}
          {state.showHeatmap && state.originalGeometry && (
            <div
              role="region"
              aria-label="Heatmap legend"
              style={{
                position: 'absolute',
                bottom: spacing.lg,
                right: spacing.lg,
                background: 'rgba(18, 24, 43, 0.85)',
                border: `1px solid ${colors.borderPanel}`,
                borderRadius: radii.md,
                padding: `${spacing.sm}px ${spacing.md}px`,
                color: colors.textPrimary,
                fontSize: fontSizes.xs,
                display: 'flex',
                flexDirection: 'column',
                gap: spacing.xs,
                zIndex: 5,
                pointerEvents: 'none',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>Demoldability</div>
              <LegendRow color="#4ade80" label="Draftable" />
              <LegendRow color="#facc15" label="Marginal" />
              <LegendRow color="#ef4444" label="Undercut" />
            </div>
          )}

          {/* Drop zone — previously a single full-viewport button, now a
              two-action region (load file vs. try sample) so first-time
              users aren't stuck if they don't have an STL handy. The outer
              div handles drag-over styling; the primary affordance is
              still a real <button> for keyboard + screen-reader access. */}
          {!state.originalGeometry && (
            <div
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                background: 'rgba(18, 24, 43, 0.85)',
                color: colors.textPrimary,
                fontFamily: 'inherit',
              }}
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
              <div style={{ fontSize: fontSizes.lg, fontWeight: 600, marginBottom: spacing.sm }}>
                Drop a 3D model here
              </div>
              <div style={{ fontSize: fontSizes.md, color: colors.textFaint, marginBottom: spacing.lg }}>
                Supports STL and OBJ files
              </div>
              <div style={{ display: 'flex', gap: spacing.md }}>
                <button
                  type="button"
                  onClick={handleFileLoad}
                  style={{
                    background: colors.primary,
                    color: colors.textPrimary,
                    border: 'none',
                    borderRadius: radii.md,
                    padding: `${spacing.md}px ${spacing.xl}px`,
                    fontSize: fontSizes.md,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  aria-label="Load a 3D model file"
                >
                  Browse Files
                </button>
                <button
                  type="button"
                  onClick={handleLoadSample}
                  style={{
                    background: 'transparent',
                    color: colors.textPrimary,
                    border: `1px solid ${colors.borderPanel}`,
                    borderRadius: radii.md,
                    padding: `${spacing.md}px ${spacing.xl}px`,
                    fontSize: fontSizes.md,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  aria-label="Load the built-in sample model"
                >
                  Try Sample
                </button>
              </div>
            </div>
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
          onToggleHeatmap={() => setState(prev => ({ ...prev, showHeatmap: !prev.showHeatmap }))}
          onStartOver={() => setState(initialState)}
        />
      </div>

      {/* Floating help button — always available as a mouse affordance for
          users who don't know about `?`. Positioned bottom-right of the
          whole window, inside the main viewport's visual space. */}
      <button
        type="button"
        onClick={() => setShortcutHelpOpen(true)}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        style={{
          position: 'fixed',
          bottom: spacing.lg,
          left: spacing.lg,
          width: 32, height: 32,
          borderRadius: '50%',
          background: colors.sectionBg,
          border: `1px solid ${colors.borderSection}`,
          color: colors.textBody,
          fontSize: fontSizes.md,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'inherit',
          zIndex: 5,
        }}
      >
        ?
      </button>

      {shortcutHelpOpen && (
        <ShortcutCheatSheet onClose={() => setShortcutHelpOpen(false)} />
      )}
    </>
  );
}

/**
 * Keyboard-shortcut cheat-sheet overlay. Triggered by `?`, dismissed by
 * Escape or clicking the backdrop. Uses role="dialog" + aria-modal so
 * screen readers announce it as a modal and focus is trapped by the
 * platform. Deliberately NOT a form — no submit button, no focusable
 * fields — so the native focus-trap behavior is sufficient.
 */
function ShortcutCheatSheet({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['?', 'Toggle this cheat sheet'],
    ['O', 'Open a file (browse)'],
    ['G', 'Generate mold'],
    ['A', 'Auto-detect parting plane'],
    ['H', 'Toggle demoldability heatmap'],
    ['E', 'Toggle exploded view'],
    ['X / Y / Z', 'Set parting axis'],
    ['Esc', 'Close this overlay'],
  ];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.panelBg,
          border: `1px solid ${colors.borderPanel}`,
          borderRadius: radii.lg,
          padding: `${spacing.xl}px ${spacing.xl + spacing.sm}px`,
          color: colors.textPrimary,
          minWidth: 360,
          maxWidth: 480,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: spacing.lg,
        }}>
          <div style={{ fontSize: fontSizes.lg, fontWeight: 600 }}>
            Keyboard Shortcuts
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            style={{
              background: 'transparent',
              color: colors.textMuted,
              border: 'none',
              fontSize: fontSizes.lg,
              cursor: 'pointer',
              padding: spacing.xs,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: spacing.lg, rowGap: spacing.sm }}>
          {rows.map(([key, label]) => (
            <Fragment key={key}>
              <kbd style={{
                background: colors.sectionBg,
                border: `1px solid ${colors.borderSection}`,
                borderRadius: radii.sm,
                padding: `${spacing.xs}px ${spacing.sm}px`,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: fontSizes.sm,
                color: colors.textPrimary,
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}>
                {key}
              </kbd>
              <span style={{ fontSize: fontSizes.sm, color: colors.textBody, alignSelf: 'center' }}>
                {label}
              </span>
            </Fragment>
          ))}
        </div>
        <div style={{
          marginTop: spacing.lg,
          fontSize: fontSizes.xs,
          color: colors.textDim,
          textAlign: 'center',
        }}>
          Press <kbd style={{
            background: colors.sectionBg,
            border: `1px solid ${colors.borderSection}`,
            borderRadius: radii.sm,
            padding: `0 ${spacing.xs}px`,
            fontFamily: 'ui-monospace, monospace',
            fontSize: fontSizes.xs,
          }}>?</kbd> anytime to reopen
        </div>
      </div>
    </div>
  );
}

/** Single color-swatch + label row inside the heatmap legend. */
function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
      <span
        aria-hidden="true"
        style={{
          width: 12, height: 12, borderRadius: 2, background: color,
          border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0,
        }}
      />
      <span>{label}</span>
    </div>
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
