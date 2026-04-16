import React from 'react';
import type { AppState, Axis } from '../App';

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
    background: '#16213e',
    borderLeft: '1px solid #2a2a4a',
    padding: 20,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
    overflowY: 'auto' as const,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
  },
  section: {
    background: '#1a1a3e',
    borderRadius: 8,
    padding: 14,
    border: '1px solid #2a2a5a',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#aaa',
    marginBottom: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  button: {
    width: '100%',
    padding: '10px 16px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    transition: 'all 0.15s',
  },
  primaryBtn: {
    background: '#ff6b35',
    color: '#fff',
  },
  secondaryBtn: {
    background: '#2a2a5a',
    color: '#ccc',
  },
  disabledBtn: {
    opacity: 0.5,
    cursor: 'not-allowed' as const,
  },
  axisBtn: (active: boolean) => ({
    flex: 1,
    padding: '8px 12px',
    borderRadius: 4,
    border: active ? '2px solid #ff6b35' : '1px solid #333',
    background: active ? '#ff6b3520' : '#1a1a2e',
    color: active ? '#ff6b35' : '#888',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
  }),
  slider: {
    width: '100%',
    accentColor: '#ff6b35',
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 0',
  },
  label: {
    fontSize: 13,
    color: '#bbb',
  },
  fileInfo: {
    fontSize: 13,
    color: '#7a9ec2',
    wordBreak: 'break-all' as const,
  },
  exportBtn: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 4,
    border: '1px solid #333',
    background: '#1a1a2e',
    color: '#ccc',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
  },
};

export default function ControlPanel({
  state, onLoadFile, onAxisChange, onOffsetChange,
  onGenerate, onAutoDetect, onExport,
  onToggleExplode, onToggleOriginal, onStartOver,
}: ControlPanelProps) {
  const hasModel = !!state.originalGeometry;
  const hasMold = state.moldGenerated;

  return (
    <div style={styles.panel}>
      <div>
        <div style={styles.title}>Mold Maker</div>
        <div style={styles.subtitle}>Open-source two-part mold generator</div>
      </div>

      {/* File Section */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Model</div>
        {state.fileName && (
          <div style={{ ...styles.fileInfo, marginBottom: 10 }}>
            {state.fileName}
          </div>
        )}
        <button
          style={{ ...styles.button, ...styles.secondaryBtn }}
          onClick={onLoadFile}
        >
          {hasModel ? 'Load Different Model' : 'Open STL / OBJ File'}
        </button>
      </div>

      {/* Parting Plane Section */}
      {hasModel && !hasMold && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Parting Plane</div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['x', 'y', 'z'] as Axis[]).map(a => (
              <button
                key={a}
                style={styles.axisBtn(state.axis === a)}
                onClick={() => onAxisChange(a)}
              >
                {a.toUpperCase()} Axis
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ ...styles.label, marginBottom: 4 }}>
              Plane Position: {Math.round(state.planeOffset * 100)}%
            </div>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.01}
              value={state.planeOffset}
              onChange={e => onOffsetChange(parseFloat(e.target.value))}
              style={styles.slider}
            />
          </div>

          <button
            style={{
              ...styles.button, ...styles.secondaryBtn,
              marginBottom: 8,
              ...(state.autoDetecting ? styles.disabledBtn : {}),
            }}
            onClick={onAutoDetect}
            disabled={state.autoDetecting}
          >
            {state.autoDetecting ? 'Analyzing planes...' : 'Auto-Detect Optimal Plane'}
          </button>

          <button
            style={{
              ...styles.button, ...styles.primaryBtn,
              ...(state.generating ? styles.disabledBtn : {}),
            }}
            onClick={onGenerate}
            disabled={state.generating}
          >
            {state.generating ? 'Generating Mold...' : 'Generate Mold'}
          </button>
        </div>
      )}

      {/* View Options */}
      {hasMold && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>View</div>
          <div style={styles.toggle}>
            <span style={styles.label}>Exploded View</span>
            <ToggleSwitch active={state.explodedView} onClick={onToggleExplode} />
          </div>
          <div style={styles.toggle}>
            <span style={styles.label}>Show Original</span>
            <ToggleSwitch active={state.showOriginal} onClick={onToggleOriginal} />
          </div>
        </div>
      )}

      {/* Export Section */}
      {hasMold && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Export</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={styles.exportBtn} onClick={() => onExport('stl')}>STL</button>
            <button style={styles.exportBtn} onClick={() => onExport('obj')}>OBJ</button>
            <button style={styles.exportBtn} onClick={() => onExport('3mf')}>3MF</button>
          </div>
        </div>
      )}

      {/* Start Over */}
      {hasModel && (
        <button
          style={{ ...styles.button, ...styles.secondaryBtn, marginTop: 'auto' }}
          onClick={onStartOver}
        >
          Start Over
        </button>
      )}
    </div>
  );
}

function ToggleSwitch({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: active ? '#ff6b35' : '#333',
        cursor: 'pointer', position: 'relative',
        transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 9,
        background: '#fff', position: 'absolute',
        top: 3, left: active ? 23 : 3,
        transition: 'left 0.2s',
      }} />
    </div>
  );
}
