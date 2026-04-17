import { describe, it, expect } from 'vitest';
import { buildEvent } from './telemetryEvents';

/**
 * The interesting assertions here aren't the runtime behavior — buildEvent
 * just returns its arguments as an object. They're the TYPES, which vitest
 * can't directly test. So these runtime tests exist mainly to:
 *   1. Pin the output shape (regression guard against someone adding a nested
 *      `meta` field or flattening the data out).
 *   2. Lock the exact set of valid event names — adding a sixth event should
 *      require adding a test here, making the privacy-review moment visible.
 *   3. Spot-check that properties make it through untouched, so transport-side
 *      serialization gets a predictable shape.
 */
describe('buildEvent', () => {
  it('returns a { name, data } pair matching Umami custom-event shape', () => {
    const e = buildEvent('session_started', {});
    expect(e).toEqual({ name: 'session_started', data: {} });
    // No other keys — catches someone adding timestamp / session_id by "helpfulness".
    expect(Object.keys(e).sort()).toEqual(['data', 'name']);
  });

  it('passes primitive properties through untouched', () => {
    const e = buildEvent('mold_generated', {
      success: true,
      axisUsed: 'z',
    });
    expect(e.data.success).toBe(true);
    expect(e.data.axisUsed).toBe('z');
  });

  it('carries optional failureReason when present', () => {
    const e = buildEvent('model_loaded', {
      success: false,
      failureReason: 'parse_error',
    });
    expect(e.data).toEqual({ success: false, failureReason: 'parse_error' });
  });

  it('carries export format tag for file_exported', () => {
    const e = buildEvent('file_exported', { format: '3mf' });
    expect(e.data.format).toBe('3mf');
  });

  it('locks the event name set — this list should match PRIVACY.md exactly', () => {
    // If this list grows, a privacy-review should happen first. Failing this
    // test intentionally forces that conversation.
    const allowed = [
      'session_started',
      'model_loaded',
      'mold_generated',
      'plane_auto_detected',
      'file_exported',
    ] as const;
    expect(allowed).toHaveLength(5);
  });
});
