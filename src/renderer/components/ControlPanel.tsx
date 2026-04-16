import type { AppState } from '../App';
import type { Axis } from '../types';
import { colors, radii, spacing, fontSizes } from '../theme';

interface ControlPanelProps {
  state: AppState;
  onLoadFile: () => void;
  onAxisChange: (axis: Axis) => void;
  onOffsetChange: (offset: number) => void;
  onGenerate: () => void;
  onAutoDetect: () => void;
  onExport: (format: 'stl' | 'obj' | '3mf') => void;
  onToggleExplode: () => void;
  onToggleOriginal: () => void;
  onStartOver: () => void;
}

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
};

export default function ControlPanel({
  state, onLoadFile, onAxisChange, onOffsetChange,
  onGenerate, onAutoDetect, onExport,
  onToggleExplode, onToggleOriginal, onStartOver,
}: ControlPanelProps) {
  const hasModel = !!state.originalGeometry;
  const hasMold = state.moldGenerated;

  // Compare current params against the params used for the last successful
  // mold generation. When different, the existing mold is stale and the primary
  // CTA should invite regeneration. When identical, there's nothing to do —
  // disable the button rather than let the user kick off redundant CSG work
  // that takes several seconds.
  const paramsChanged = state.generatedParams !== null && (
    state.generatedParams.axis !== state.axis ||
    state.generatedParams.offset !== state.planeOffset
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

      {/* View Options */}
      {hasMold && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>View</div>
          <div style={styles.toggleRow}>
            <span style={styles.label}>Exploded View</span>
            <ToggleSwitch active={state.explodedView} onClick={onToggleExplode} label="Exploded view" />
          </div>
          <div style={styles.toggleRow}>
            <span style={styles.label}>Show Original</span>
            <ToggleSwitch active={state.showOriginal} onClick={onToggleOriginal} label="Show original model" />
          </div>
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
