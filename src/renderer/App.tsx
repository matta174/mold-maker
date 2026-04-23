import { useState, useCallback, useEffect, useRef, Fragment, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import ModelViewer from './components/ModelViewer';
import ControlPanel from './components/ControlPanel';
import PartingPlane from './components/PartingPlane';
import HeatmapOverlay from './components/HeatmapOverlay';
import { useMoldGenerator, EXPLODE_OFFSET_RATIO } from './hooks/useMoldGenerator';
import { loadFile, parseFile } from './utils/fileLoader';
import { createSampleModel } from './utils/sampleModel';
import type { Axis, MoldBoxShape } from './types';
import { colors, radii, spacing, fontSizes, focusVisibleCss } from './theme';
import { WALL_THICKNESS_RATIO, CLEARANCE_RATIO } from './mold/constants';
import { translateStepError } from './mold/stepExportErrors';
import { useTelemetry } from './services/useTelemetry';
import { buildEvent } from './services/telemetryEvents';
import FirstRunTelemetryModal from './components/FirstRunTelemetryModal';

export type { Axis } from './types';

/**
 * Re-aims the camera along the parting axis whenever it changes, so the
 * "top" face of the mold (where the sprue exits) always faces the viewer.
 * Previously the camera stayed pinned to a fixed isometric angle and the
 * pour hole silently drew itself onto the face pointing AWAY from the
 * camera — users reasonably concluded "there's no pour hole" or "it's
 * coming out through the side."
 *
 * Preserves the user's current zoom distance (length of camera.position)
 * so switching axis doesn't snap the view back to a default distance and
 * undo whatever they'd orbited into. Also re-targets OrbitControls at the
 * origin to keep pan state sane.
 */
function CameraRig({ axis }: { axis: Axis }) {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as {
    target?: THREE.Vector3;
    update?: () => void;
  } | null;
  // Only reorient on axis change, not on every render. Otherwise any state
  // update would snap the camera back to its canonical angle.
  const prevAxis = useRef<Axis | null>(null);
  useEffect(() => {
    if (prevAxis.current === axis) return;
    prevAxis.current = axis;

    const dist = camera.position.length() || 120;
    // Bias along +axis so the sprue-exit face of the top half is visible;
    // smaller tilts on the two lateral axes keep depth cues intact so the
    // view doesn't collapse to an orthographic-looking silhouette.
    const pos: [number, number, number] = [0, 0, 0];
    const primary = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    pos[primary] = dist * 0.78;
    pos[(primary + 1) % 3] = dist * 0.45;
    pos[(primary + 2) % 3] = dist * 0.45;
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    if (controls?.target && typeof controls.update === 'function') {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [axis, camera, controls]);
  return null;
}

/**
 * Snapshot of the parameters a given mold was generated with. When the current
 * parameters drift from this snapshot, the UI knows the mold is stale and
 * surfaces a "Regenerate Mold" CTA instead of silently discarding the mold.
 */
export interface GeneratedParams {
  axis: Axis;
  offset: number;
  /** Cut-plane tilt around hinge axis, degrees. 0 = axis-aligned. */
  cutAngle: number;
  wallThicknessRatio: number;
  clearanceRatio: number;
  /** Outer shell shape. Included in the staleness check — changing it must
   *  re-generate the mold, since it changes the CSG output geometry. */
  moldBoxShape: MoldBoxShape;
  /**
   * User-specified sprue lateral coords that were in effect at generation
   * time, or null when auto-placement was used. Included in the staleness
   * check so toggling the override or changing its coords forces a
   * regenerate rather than silently leaving stale CSG on screen.
   */
  sprueOverride: { a: number; b: number } | null;
}

export interface AppState {
  originalGeometry: THREE.BufferGeometry | null;
  fileName: string;
  axis: Axis;
  planeOffset: number;
  /**
   * Parting-plane tilt around the hinge axis, in degrees. 0 = axis-aligned.
   * Range [-30, 30]. Only actually honoured when ENABLE_OBLIQUE_PLANES is
   * true; otherwise it's threaded through state for forward compat but the
   * generator treats it as 0.
   */
  cutAngle: number;
  /** Wall thickness as a fraction of max bbox extent. User-tunable; defaults to constants. */
  wallThicknessRatio: number;
  /** Clearance between mating surfaces as a fraction of wall thickness. User-tunable. */
  clearanceRatio: number;
  /** Outer shell shape. Defaults to 'rect'. */
  moldBoxShape: MoldBoxShape;
  /**
   * Sprue placement override. When `enabled` is true, `a` and `b` are used
   * verbatim as the lateral sprue coords in the current axis's frame (see
   * ComputeChannelOpts). When false or when the user hasn't opted in, the
   * auto-placement centroid path runs unchanged.
   *
   * Why an `enabled` flag rather than just `null` → we want to retain the
   * user's last-entered coords when they toggle auto/manual back and forth,
   * so they don't lose the position they dialled in.
   */
  sprueOverride: { enabled: boolean; a: number; b: number };
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
  /** Render loaded model + mold halves as wireframe — off by default. Useful for
   *  inspecting mesh topology when CSG fails or diagnosing boolean artifacts. */
  wireframe: boolean;
  generating: boolean;
  boundingBox: THREE.Box3 | null;
  /** User-facing error message for load / generate / auto-detect failures. */
  errorMessage: string | null;
  /**
   * Uniform display/export scale applied to the part + generated mold. 1.0 = no
   * scaling (default). Applied non-destructively: the generated mold geometry
   * is always produced at 1:1, then a Three `<group scale>` wraps the viewport
   * and a Matrix4 scale is baked into the export. Means the user can try
   * different scales without re-running CSG (which takes seconds).
   *
   * Kept OUT of GeneratedParams deliberately — changing scale does NOT stale
   * the mold. The mold topology is the same, just visually/exported at a
   * different size.
   */
  scale: number;
  /**
   * Currently selected printer preset id, or null if no printer is picked
   * (default). `null` hides the fit readout entirely — unknown printer means
   * we can't say anything true about fit.
   */
  selectedPrinterId: string | null;
}

const initialState: AppState = {
  originalGeometry: null,
  fileName: '',
  axis: 'z',
  planeOffset: 0.5,
  cutAngle: 0,
  wallThicknessRatio: WALL_THICKNESS_RATIO,
  clearanceRatio: CLEARANCE_RATIO,
  moldBoxShape: 'rect',
  sprueOverride: { enabled: false, a: 0, b: 0 },
  autoDetecting: false,
  moldGenerated: false,
  topMold: null,
  bottomMold: null,
  generatedParams: null,
  explodedView: true,
  showOriginal: true,
  showHeatmap: false,
  wireframe: false,
  generating: false,
  boundingBox: null,
  errorMessage: null,
  scale: 1.0,
  selectedPrinterId: null,
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  /**
   * Cheat-sheet overlay visibility. Pure UI ephemeral state — doesn't need
   * to survive anything, doesn't need to flow through ControlPanel, so it
   * lives outside AppState.
   */
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  /**
   * First-run telemetry consent modal visibility. Set to true in the
   * mold_generated success branch IFF telemetry is configured and we haven't
   * asked the user yet. Deliberately NOT stored in AppState — it's a
   * one-shot modal driven by a settings value that already persists.
   */
  const [telemetryModalOpen, setTelemetryModalOpen] = useState(false);
  /**
   * Busy indicator for STEP export specifically. Other formats finish in
   * milliseconds so they don't need a visible state. STEP can run for ~60s
   * total (both halves) in a worker, so the UI disables other export buttons
   * and swaps the STEP button for a Cancel button while it's in flight.
   */
  const [stepExporting, setStepExporting] = useState(false);
  const { generateMold, exportFiles, cancelStepExport, autoDetectPlane } = useMoldGenerator();
  const telemetry = useTelemetry();

  // ── Telemetry: session_started ──
  // Fires once per mount. Empty dep array is intentional — React 18's
  // strict-mode double-invoke in dev will double-fire; production builds
  // won't. The send call itself is safely no-op when disabled/unconfigured,
  // so double-fire in dev is a cosmetic dashboard issue, not a correctness one.
  useEffect(() => {
    telemetry.send(buildEvent('session_started', {}));
    // telemetry.send is a stable useCallback — but listing it would tangle
    // the lint dep array with first-render semantics. Disable is localized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Telemetry: model_loaded (success). No properties from the file — not
    // size, not triangle count, not filename. "Did a load succeed" is the
    // entire question this event answers.
    telemetry.send(buildEvent('model_loaded', { success: true }));
  }, [telemetry]);

  const handleFileLoad = useCallback(async () => {
    try {
      const result = await loadFile();
      if (!result) return; // user canceled — not an error, not a telemetry event
      commitGeometry(result.geometry, result.fileName);
    } catch (err) {
      console.error('File load failed:', err);
      telemetry.send(buildEvent('model_loaded', { success: false, failureReason: 'parse_error' }));
      setState(prev => ({
        ...prev,
        errorMessage: err instanceof Error ? err.message : 'Failed to load file.',
      }));
    }
  }, [commitGeometry, telemetry]);

  const handleLoadSample = useCallback(() => {
    try {
      const { geometry, fileName } = createSampleModel();
      commitGeometry(geometry, fileName);
    } catch (err) {
      console.error('Sample load failed:', err);
      telemetry.send(buildEvent('model_loaded', { success: false, failureReason: 'unknown' }));
      setState(prev => ({
        ...prev,
        errorMessage: err instanceof Error ? err.message : 'Failed to load sample.',
      }));
    }
  }, [commitGeometry, telemetry]);

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
      telemetry.send(buildEvent('model_loaded', { success: false, failureReason: 'parse_error' }));
      setState(prev => ({
        ...prev,
        errorMessage: err instanceof Error ? err.message : 'Failed to load dropped file.',
      }));
    }
  }, [commitGeometry, telemetry]);

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
    const activeSprueOverride = state.sprueOverride.enabled
      ? { a: state.sprueOverride.a, b: state.sprueOverride.b }
      : null;

    const params: GeneratedParams = {
      axis: state.axis,
      offset: state.planeOffset,
      cutAngle: state.cutAngle,
      wallThicknessRatio: state.wallThicknessRatio,
      clearanceRatio: state.clearanceRatio,
      moldBoxShape: state.moldBoxShape,
      sprueOverride: activeSprueOverride,
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
          moldBoxShape: params.moldBoxShape,
          cutAngle: params.cutAngle,
          sprueOverride: params.sprueOverride ?? undefined,
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
      // Telemetry: mold_generated (success). `axisUsed` lets us spot whether
      // Z dominates (it will) or any axis is unexpectedly common — a signal
      // about auto-detect quality and the default axis choice.
      telemetry.send(buildEvent('mold_generated', { success: true, axisUsed: params.axis }));
      // Consent moment: AFTER the user has just seen the product deliver
      // value, not before. Gated on `configured` so open-source forks without
      // a telemetry host never see this modal, and on `needsConsent` so we
      // don't re-ask users who've already made a decision.
      if (telemetry.configured && telemetry.needsConsent) {
        setTelemetryModalOpen(true);
      }
    } catch (err) {
      console.error('Mold generation failed:', err);
      // Coarse failure tagging only — the exception message may contain
      // details we don't want to exfiltrate. 'csg_failed' covers the vast
      // majority of cases (boolean op threw, result was empty). If we later
      // want to distinguish non_manifold, add a typed check in the mold code
      // and surface a distinct error class, not a message string.
      telemetry.send(
        buildEvent('mold_generated', {
          success: false,
          axisUsed: params.axis,
          failureReason: 'csg_failed',
        }),
      );
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
    state.axis, state.planeOffset, state.cutAngle,
    state.wallThicknessRatio, state.clearanceRatio,
    state.sprueOverride,
    state.generating, generateMold, telemetry,
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
      // Telemetry: plane_auto_detected (success). Compare `axisDetected`
      // against the later `mold_generated.axisUsed` in the dashboard to
      // estimate how often users accept vs override auto-detect.
      telemetry.send(
        buildEvent('plane_auto_detected', { success: true, axisDetected: result.axis }),
      );
    } catch (err) {
      console.error('Auto-detect failed:', err);
      telemetry.send(buildEvent('plane_auto_detected', { success: false }));
      setState(prev => ({
        ...prev,
        autoDetecting: false,
        errorMessage: err instanceof Error ? err.message : 'Auto-detect failed.',
      }));
    }
  }, [state.originalGeometry, state.autoDetecting, autoDetectPlane, telemetry]);

  const handleExport = useCallback(async (format: 'stl' | 'obj' | '3mf' | 'step') => {
    if (!state.topMold || !state.bottomMold) return;
    // STEP runs for ~60s in a worker — flip the busy flag so the panel can
    // disable the other formats and swap the STEP button for a Cancel button.
    // Other formats finish in <100ms; not worth a re-render storm for them.
    if (format === 'step') setStepExporting(true);
    try {
      // Pass the current scale. Export bakes it into the geometry so the STL
      // matches what the user sees in the viewport (where the scale is
      // applied via a <group scale> wrapper). Scale 1.0 is the no-op path.
      await exportFiles(
        state.topMold, state.bottomMold, state.fileName, format, state.scale,
      );
      // Telemetry: file_exported (success only — we don't event failures here
      // because export failures are extremely rare and the signal we actually
      // want is "which format matters", which is the success count per format).
      // STEP success-count specifically answers task #27: "is the 66 MB OCP
      // bundle pulling its weight, or should we lazy-load / split it?"
      telemetry.send(buildEvent('file_exported', { format }));
    } catch (err) {
      // 'Export cancelled' is the user's choice, not a failure — surface a
      // gentler note (and skip the console.error noise) so it doesn't look
      // like the app broke.
      const isCancel = err instanceof Error && err.message === 'Export cancelled';
      if (!isCancel) {
        // Keep the raw error in the console for bug reports — translateStepError
        // only shapes what the USER sees. A technical message still needs to be
        // grep-able from a support thread.
        console.error('Export failed:', err);
      }
      const raw = err instanceof Error ? err.message : 'Export failed.';
      // Only STEP has a translation table — other exporters are fast, local,
      // and their errors are already user-friendly ("File write failed" etc.).
      const userFacing = format === 'step' ? translateStepError(raw) : raw;
      setState(prev => ({
        ...prev,
        errorMessage: isCancel ? null : userFacing,
      }));
    } finally {
      if (format === 'step') setStepExporting(false);
    }
  }, [state.topMold, state.bottomMold, state.fileName, state.scale, exportFiles, telemetry]);

  const handleCancelStepExport = useCallback(() => {
    cancelStepExport();
    // Hide the busy state immediately — the awaiter in handleExport will
    // also flip it via finally, but the user just clicked Cancel and a
    // 100ms gap before the button stops saying "Exporting…" looks broken.
    setStepExporting(false);
  }, [cancelStepExport]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, errorMessage: null }));
  }, []);

  // Memoized params comparison. Used by both the keyboard shortcut handler
  // and the visual parting plane indicator. Includes sprueOverrideChanged so
  // the two stay in sync: if the user only changes sprue override position,
  // both the indicator and keyboard shortcut recognize the mold as stale.
  const { paramsChanged } = useMemo(() => {
    const currentActiveOverride = state.sprueOverride.enabled
      ? { a: state.sprueOverride.a, b: state.sprueOverride.b }
      : null;
    const sprueOverrideChanged = state.generatedParams !== null && (() => {
      const gen = state.generatedParams.sprueOverride;
      if (gen === null && currentActiveOverride === null) return false;
      if (gen === null || currentActiveOverride === null) return true;
      return gen.a !== currentActiveOverride.a || gen.b !== currentActiveOverride.b;
    })();

    const paramsChanged = state.generatedParams !== null && (
      state.generatedParams.axis !== state.axis ||
      state.generatedParams.offset !== state.planeOffset ||
      state.generatedParams.cutAngle !== state.cutAngle ||
      state.generatedParams.wallThicknessRatio !== state.wallThicknessRatio ||
      state.generatedParams.clearanceRatio !== state.clearanceRatio ||
      state.generatedParams.moldBoxShape !== state.moldBoxShape ||
      sprueOverrideChanged
    );

    return { paramsChanged };
  }, [
    state.generatedParams,
    state.axis,
    state.planeOffset,
    state.cutAngle,
    state.wallThicknessRatio,
    state.clearanceRatio,
    state.moldBoxShape,
    state.sprueOverride,
  ]);

  // ── Global keyboard shortcuts ──
  // Installed once per relevant-state change. The skip-if-in-input check is
  // critical: without it, hitting "X" while focused on the plane-position
  // slider would try to jump to X-axis *and* nudge the slider. Range inputs
  // in particular use arrow keys, so we want zero interception while one is
  // focused.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === 'INPUT';
      const inputType = isInput ? (target as HTMLInputElement).type : '';
      const isTextInput = target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        (isInput && ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(inputType));
      const isFormControl = isTextInput || target?.tagName === 'SELECT' || isInput;

      const isGenerateShortcut = (e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.altKey;
      if (isTextInput && isGenerateShortcut) return;
      if (isFormControl && !isGenerateShortcut) return;

      if (isGenerateShortcut) {
        const shortcutEnabled = !!state.originalGeometry && !!state.boundingBox && !state.generating &&
          (!state.moldGenerated || paramsChanged);
        if (shortcutEnabled) {
          e.preventDefault();
          handleGenerate();
          return;
        }
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
        case 'w':
          if (state.originalGeometry) {
            e.preventDefault();
            setState(prev => ({ ...prev, wireframe: !prev.wireframe }));
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
    state.generatedParams, state.axis, state.planeOffset, state.cutAngle,
    state.wallThicknessRatio, state.clearanceRatio, state.moldBoxShape,
    state.boundingBox,
    paramsChanged,
    handleFileLoad, handleGenerate, handleAutoDetect,
  ]);

  // Visual indicator of the current parting plane. Shown before first generation
  // OR after, when the user has moved the slider/axis away from the params the
  // current mold was generated with (so the indicator marks where the *next*
  // cut will happen, not the old one).
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
            <CameraRig axis={state.axis} />
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <directionalLight position={[-5, -5, -5]} intensity={0.3} />

            {/* Print-scale wrapper: everything inside scales together so the
                viewport visually matches the exported STL size. The grid and
                gizmo stay OUTSIDE this group on purpose — they're world-space
                reference (grid squares are "true mm", gizmo is orientation,
                scaling them would defeat their job). The explode offset is
                computed from the 1:1 bbox, so it ends up scaled here — which
                is what we want (exploded halves move apart proportionally). */}
            <group scale={[state.scale, state.scale, state.scale]}>
              {/* Heatmap takes precedence over the normal original mesh — both
                  at the same coordinates would Z-fight and the flat unlit
                  heatmap colors would fight the lit physical material. */}
              {state.originalGeometry && state.boundingBox && state.showHeatmap && (
                <HeatmapOverlay
                  geometry={state.originalGeometry}
                  axis={state.axis}
                  offset={state.planeOffset}
                  boundingBox={state.boundingBox}
                  cutAngle={state.cutAngle}
                />
              )}

              {state.originalGeometry && !state.showHeatmap && state.showOriginal && (
                <ModelViewer
                  geometry={state.originalGeometry}
                  color="#6c9bcf"
                  opacity={state.moldGenerated ? 0.3 : 0.9}
                  wireframe={state.wireframe}
                />
              )}

              {state.moldGenerated && state.topMold && (
                <ModelViewer
                  geometry={state.topMold}
                  color="#5b9bd5"
                  opacity={0.85}
                  position={state.explodedView ? getExplodeOffset(state.axis, 1, state.boundingBox!) : [0, 0, 0]}
                  wireframe={state.wireframe}
                />
              )}

              {state.moldGenerated && state.bottomMold && (
                <ModelViewer
                  geometry={state.bottomMold}
                  color="#e07070"
                  opacity={0.85}
                  position={state.explodedView ? getExplodeOffset(state.axis, -1, state.boundingBox!) : [0, 0, 0]}
                  wireframe={state.wireframe}
                />
              )}

              {showPartingPlaneIndicator && (
                <PartingPlane
                  axis={state.axis}
                  offset={state.planeOffset}
                  boundingBox={state.boundingBox!}
                  cutAngle={state.cutAngle}
                />
              )}
            </group>

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
          onCutAngleChange={(cutAngle: number) => setState(prev => ({ ...prev, cutAngle }))}
          onSprueOverrideToggle={(enabled: boolean) => setState(prev => ({
            ...prev,
            sprueOverride: { ...prev.sprueOverride, enabled },
          }))}
          onSprueOverrideAChange={(a: number) => setState(prev => ({
            ...prev,
            sprueOverride: { ...prev.sprueOverride, a },
          }))}
          onSprueOverrideBChange={(b: number) => setState(prev => ({
            ...prev,
            sprueOverride: { ...prev.sprueOverride, b },
          }))}
          onWallThicknessChange={(wallThicknessRatio: number) =>
            setState(prev => ({ ...prev, wallThicknessRatio }))}
          onClearanceChange={(clearanceRatio: number) =>
            setState(prev => ({ ...prev, clearanceRatio }))}
          onMoldBoxShapeChange={(moldBoxShape: MoldBoxShape) =>
            setState(prev => ({ ...prev, moldBoxShape }))}
          onResetDimensions={() => setState(prev => ({
            ...prev,
            wallThicknessRatio: WALL_THICKNESS_RATIO,
            clearanceRatio: CLEARANCE_RATIO,
            moldBoxShape: 'rect',
          }))}
          onGenerate={handleGenerate}
          onAutoDetect={handleAutoDetect}
          onExport={handleExport}
          onToggleExplode={() => setState(prev => ({ ...prev, explodedView: !prev.explodedView }))}
          onToggleOriginal={() => setState(prev => ({ ...prev, showOriginal: !prev.showOriginal }))}
          onToggleHeatmap={() => setState(prev => ({ ...prev, showHeatmap: !prev.showHeatmap }))}
          onToggleWireframe={() => setState(prev => ({ ...prev, wireframe: !prev.wireframe }))}
          onStartOver={() => setState(initialState)}
          onPrinterChange={(selectedPrinterId: string | null) =>
            setState(prev => ({ ...prev, selectedPrinterId }))}
          onScaleChange={(scale: number) =>
            setState(prev => ({ ...prev, scale }))}
          onResetScale={() =>
            setState(prev => ({ ...prev, scale: 1.0 }))}
          telemetryConfigured={telemetry.configured}
          telemetryEnabled={telemetry.settings.telemetryEnabled}
          onTelemetryAllow={telemetry.grant}
          onTelemetryDecline={telemetry.decline}
          stepExporting={stepExporting}
          onCancelStepExport={handleCancelStepExport}
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

      {/* First-run consent modal. Only ever visible if the build was
          configured with a telemetry host AND the user hasn't yet been
          asked. Rendered outside the main layout flow so it can overlay
          everything including the control panel. */}
      {telemetryModalOpen && (
        <FirstRunTelemetryModal
          onAllow={() => {
            telemetry.grant();
            setTelemetryModalOpen(false);
          }}
          onDecline={() => {
            telemetry.decline();
            setTelemetryModalOpen(false);
          }}
          onDismiss={() => {
            // Escape / backdrop — close without recording a decision. The
            // modal will reappear on the next successful mold generation.
            // See component docblock for why we don't treat this as decline.
            setTelemetryModalOpen(false);
          }}
        />
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
    ['W', 'Toggle wireframe'],
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
