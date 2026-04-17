import type { AppState } from '../App';
import type { Axis } from '../types';
import { WALL_THICKNESS_RATIO, CLEARANCE_RATIO } from '../mold/constants';
import { colors, radii, spacing, fontSizes } from '../theme';

interface ControlPanelProps {
  state: AppState;
  onLoadFile: () => void;
  onAxisChange: (axis: Axis) => void;
  onOffsetChange: (offset: number) => void;
  onWallThicknessChange: (ratio: number) => void;
  onClearanceChange: (ratio: number) => void;
  onResetDimensions: () => void;
  onGenerate: () => void;
  onAutoDetect: () => void;
  onExport: (format: 'stl' | 'obj' | '3mf') => void;
  onToggleExplode: () => void;
  onToggleOriginal: () => void;
  onToggleHeatmap: () => void;
  onToggleWireframe: () => void;
  onStartOver: () => void;
}

// Slider bounds for the new mold-dimension controls.
// - Wall thickness: 3% floor because thinner walls risk CSG failures / paper
//   walls. 20% ceiling because beyond that the mold is wasteful bulk.
// - Clearance: 1% floor because 0 would fuse the halves. 15% ceiling because
//   beyond that registration pins wobble too loose to be useful.
const WALL_THICKNESS_MIN = 0.03;
const WALL_THICKNESS_MAX = 0.20;
const CLEARANCE_MIN = 0.01;
const CLEARANCE_MAX = 0.15;
const RATIO_STEP = 0.005;

const styles = {
  panel: {
    width: 320,
    background: colors.panelBg,
    borderLeft: `1px solid ${colors.borderPanel}`,
    padding: spacing.xl,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.lg,
    overflowY: 'auto' as const,
  },
  title: {
    fontSize: fontSizes.xl,
    fontWeight: 700,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSizes.xs,
    color: colors.textDim,
  },
  section: {
    background: colors.sectionBg,
    borderRadius: radii.lg,
    padding: spacing.md + 2, // 14 — between md(12) and lg(16)
    border: `1px solid ${colors.borderSection}`,
  },
  sectionTitle: {
    fontSize: fontSizes.sm,
    fontWeight: 600,
    color: colors.textMuted,
    marginBottom: spacing.sm + 2, // 10
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  button: {
    width: '100%',
    padding: `${spacing.sm + 2}px ${spacing.lg}px`, // 10px 16px
    borderRadius: radii.md,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: fontSizes.md,
    transition: 'all 0.15s',
  },
  primaryBtn: {
    background: colors.primary,
    color: colors.textPrimary,
  },
  secondaryBtn: {
    background: colors.borderSection,
    color: '#ccc',
  },
  disabledBtn: {
    opacity: 0.5,
    cursor: 'not-allowed' as const,
  },
  axisBtn: (active: boolean) => ({
    flex: 1,
    padding: `${spacing.sm}px ${spacing.md}px`, // 8px 12px
    borderRadius: radii.sm,
    border: active ? `2px solid ${colors.primary}` : `1px solid ${colors.borderSubtle}`,
    background: active ? colors.primaryAlpha : colors.viewportBg,
    color: active ? colors.primary : colors.textFaint,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: fontSizes.md,
  }),
  slider: {
    width: '100%',
    accentColor: colors.primary,
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${spacing.xs + 2}px 0`, // 6px 0
  },
  label: {
    fontSize: fontSizes.sm,
    color: colors.textBody,
  },
  fileInfo: {
    fontSize: fontSizes.sm,
    color: colors.fileInfo,
    wordBreak: 'break-all' as const,
  },
  exportBtn: {
    flex: 1,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderRadius: radii.sm,
    border: `1px solid ${colors.borderSubtle}`,
    background: colors.viewportBg,
    color: '#ccc',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: fontSizes.sm,
  },
  sectionHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm + 2, // match sectionTitle marginBottom
  },
  resetLinkBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.textDim,
    fontSize: fontSizes.xs,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    fontFamily: 'inherit',
  },
  resetLinkBtnDisabled: {
    opacity: 0.4,
    cursor: 'default' as const,
    textDecoration: 'none' as const,
  },
};

export default function ControlPanel({
  state, onLoadFile, onAxisChange, onOffsetChange,
  onWallThicknessChange, onClearanceChange, onResetDimensions,
  onGenerate, onAutoDetect, onExport,
  onToggleExplode, onToggleOriginal, onToggleHeatmap, onToggleWireframe, onStartOver,
}: ControlPanelProps) {
  const hasModel = !!state.originalGeometry;
  const hasMold = state.moldGenerated;

  // The reset link is only meaningful when something has actually been changed.
  // Hiding it when already-at-defaults avoids the dead-button confusion where
  // clicking it does nothing.
  const dimensionsAtDefaults =
    state.wallThicknessRatio === WALL_THICKNESS_RATIO &&
    state.clearanceRatio === CLEARANCE_RATIO;

  // Compare current params against the params used for the last successful
  // mold generation. When different, the existing mold is stale and the primary
  // CTA should invite regeneration. When identical, there's nothing to do —
  // disable the button rather than let the user kick off redundant CSG work
  // that takes several seconds.
  const paramsChanged = state.generatedParams !== null && (
    state.generatedParams.axis !== state.axis ||
    state.generatedParams.offset !== state.planeOffset ||
    state.generatedParams.wallThicknessRatio !== state.wallThicknessRatio ||
    state.generatedParams.clearanceRatio !== state.clearanceRatio
  );

  const primaryLabel = state.generating
    ? 'Generating Mold...'
    : hasMold
      ? (paramsChanged ? 'Regenerate Mold' : 'Mold Up to Date')
      : 'Generate Mold';

  const primaryDisabled = state.generating || (hasMold && !paramsChanged);

  return (
    <aside style={styles.panel} aria-label="Controls">
      <div>
        <div style={styles.title}>Mold Maker</div>
        <div style={styles.subtitle}>Open-source two-part mold generator</div>
      </div>

      {/* File Section */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Model</div>
        {state.fileName && (
          <div style={{ ...styles.fileInfo, marginBottom: spacing.sm + 2 }}>
            {state.fileName}
          </div>
        )}
        <button
          type="button"
          style={{ ...styles.button, ...styles.secondaryBtn }}
          onClick={onLoadFile}
        >
          {hasModel ? 'Load Different Model' : 'Open STL / OBJ File'}
        </button>
      </div>

      {/* Parting Plane Section — remains visible after generation so the user
          can tweak axis/offset and regenerate without the old flow silently
          discarding the mold. */}
      {hasModel && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Parting Plane</div>

          <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.md }}>
            {(['x', 'y', 'z'] as Axis[]).map(a => (
              <button
                key={a}
                type="button"
                style={styles.axisBtn(state.axis === a)}
                onClick={() => onAxisChange(a)}
                aria-pressed={state.axis === a}
              >
                {a.toUpperCase()}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: spacing.md }}>
            <label style={{ ...styles.label, marginBottom: spacing.xs, display: 'block' }}>
              Plane Position: {Math.round(state.planeOffset * 100)}%
            </label>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.01}
              value={state.planeOffset}
              onChange={e => onOffsetChange(parseFloat(e.target.value))}
              style={styles.slider}
              aria-label="Plane position"
              aria-valuetext={`${Math.round(state.planeOffset * 100)} percent`}
            />
          </div>

          {/* Draft analysis toggle — surfaces the demoldability heatmap so the
              user can SEE which faces won't release before running the CSG.
              Lives in this section on purpose: it answers the "is this axis
              the right one?" question that axis buttons + slider are posing. */}
          <div style={{ ...styles.toggleRow, marginBottom: spacing.md }}>
            <span style={styles.label}>Draft Analysis</span>
            <ToggleSwitch
              active={state.showHeatmap}
              onClick={onToggleHeatmap}
              label="Demoldability heatmap"
            />
          </div>

          <button
            type="button"
            style={{
              ...styles.button, ...styles.secondaryBtn,
              marginBottom: spacing.sm,
              ...(state.autoDetecting ? styles.disabledBtn : {}),
            }}
            onClick={onAutoDetect}
            disabled={state.autoDetecting}
            aria-live="polite"
          >
            {state.autoDetecting ? 'Analyzing planes...' : 'Auto-Detect Optimal Plane'}
          </button>

          <button
            type="button"
            style={{
              ...styles.button, ...styles.primaryBtn,
              ...(primaryDisabled ? styles.disabledBtn : {}),
            }}
            onClick={onGenerate}
            disabled={primaryDisabled}
            aria-live="polite"
          >
            {primaryLabel}
          </button>
        </div>
      )}

      {/* Mold Dimensions — wall thickness and clearance ratios were previously
          compile-time constants. Exposing them here lets the user dial in fit
          for tight tolerances (small parts) or strong shells (brittle casts).
          Changing either invalidates the current mold, same as axis/offset. */}
      {hasModel && (
        <div style={styles.section}>
          <div style={styles.sectionHeaderRow}>
            <div style={{ ...styles.sectionTitle, marginBottom: 0 }}>Mold Dimensions</div>
            <button
              type="button"
              onClick={onResetDimensions}
              disabled={dimensionsAtDefaults}
              aria-disabled={dimensionsAtDefaults}
              style={{
                ...styles.resetLinkBtn,
                ...(dimensionsAtDefaults ? styles.resetLinkBtnDisabled : {}),
              }}
            >
              Reset to defaults
            </button>
          </div>

          <div style={{ marginBottom: spacing.md }}>
            <label style={{ ...styles.label, marginBottom: spacing.xs, display: 'block' }}>
              Wall Thickness: {Math.round(state.wallThicknessRatio * 1000) / 10}% of model extent
            </label>
            <input
              type="range"
              min={WALL_THICKNESS_MIN}
              max={WALL_THICKNESS_MAX}
              step={RATIO_STEP}
              value={state.wallThicknessRatio}
              onChange={e => onWallThicknessChange(parseFloat(e.target.value))}
              style={styles.slider}
              aria-label="Wall thickness"
              aria-valuetext={`${Math.round(state.wallThicknessRatio * 1000) / 10} percent of model extent`}
            />
          </div>

          <div>
            <label style={{ ...styles.label, marginBottom: spacing.xs, display: 'block' }}>
              Clearance: {Math.round(state.clearanceRatio * 1000) / 10}% of wall thickness
            </label>
            <input
              type="range"
              min={CLEARANCE_MIN}
              max={CLEARANCE_MAX}
              step={RATIO_STEP}
              value={state.clearanceRatio}
              onChange={e => onClearanceChange(parseFloat(e.target.value))}
              style={styles.slider}
              aria-label="Clearance between mold halves"
              aria-valuetext={`${Math.round(state.clearanceRatio * 1000) / 10} percent of wall thickness`}
            />
          </div>
        </div>
      )}

      {/* View Options — promoted from hasMold-only to hasModel-and-up because
          Wireframe is useful on the *loaded* model too (CSG debugging, topology
          inspection). Exploded/Show Original still require a mold to be
          meaningful, so they stay nested behind hasMold. */}
      {hasModel && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>View</div>
          <div style={styles.toggleRow}>
            <span style={styles.label}>Wireframe</span>
            <ToggleSwitch active={state.wireframe} onClick={onToggleWireframe} label="Wireframe view" />
          </div>
          {hasMold && (
            <>
              <div style={styles.toggleRow}>
                <span style={styles.label}>Exploded View</span>
                <ToggleSwitch active={state.explodedView} onClick={onToggleExplode} label="Exploded view" />
              </div>
              <div style={styles.toggleRow}>
                <span style={styles.label}>Show Original</span>
                <ToggleSwitch active={state.showOriginal} onClick={onToggleOriginal} label="Show original model" />
              </div>
            </>
          )}
        </div>
      )}

      {/* Export Section */}
      {hasMold && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Export</div>
          <div style={{ display: 'flex', gap: spacing.sm }}>
            <button type="button" style={styles.exportBtn} onClick={() => onExport('stl')}>STL</button>
            <button type="button" style={styles.exportBtn} onClick={() => onExport('obj')}>OBJ</button>
            <button type="button" style={styles.exportBtn} onClick={() => onExport('3mf')}>3MF</button>
          </div>
        </div>
      )}

      {/* Start Over */}
      {hasModel && (
        <button
          type="button"
          style={{ ...styles.button, ...styles.secondaryBtn, marginTop: 'auto' }}
          onClick={onStartOver}
        >
          Start Over
        </button>
      )}
    </aside>
  );
}

/**
 * Accessible toggle switch. Rendered as a real <button> with role="switch" and
 * aria-checked so screen readers announce the state transition, and so it
 * responds to Space/Enter like any other button. Previously this was a <div>
 * with onClick, which meant keyboard users couldn't focus or activate it.
 */
function ToggleSwitch({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      onClick={onClick}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: active ? colors.primary : '#333',
        cursor: 'pointer', position: 'relative',
        transition: 'background 0.2s',
        border: 'none', padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          width: 18, height: 18, borderRadius: 9,
          background: '#fff', position: 'absolute',
          top: 3, left: active ? 23 : 3,
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}
