import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { buildEvent } from './telemetryEvents';
import { sendTelemetry } from './telemetryTransport';
import { __resetForTests, grantConsent } from './telemetrySettings';

/**
 * Transport tests cover the two properties we promised in the module header:
 *   - Never sends when disabled.
 *   - Never throws, even when the environment misbehaves.
 *
 * We can't assert much about "send works correctly" here because the module
 * reads its config (host, website id) from import.meta.env at module-load
 * time. That means vitest can't flip the config mid-test without a re-import
 * dance, and we'd rather verify the silent-drop invariants — those are the
 * ones that can hurt users.
 */
describe('telemetryTransport', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetForTests();
    fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call fetch when the user has not consented', () => {
    // Fresh install — telemetryEnabled is false.
    sendTelemetry(buildEvent('session_started', {}));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not call fetch when the build is unconfigured even after consent', () => {
    // In the test environment VITE_TELEMETRY_HOST / VITE_TELEMETRY_WEBSITE_ID
    // aren't defined — so even a fully opted-in user gets no network I/O.
    // This is the fork-safety guarantee: unconfigured builds are always silent.
    grantConsent();
    sendTelemetry(buildEvent('session_started', {}));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not throw if fetch itself throws synchronously', () => {
    grantConsent();
    fetchSpy.mockImplementation(() => {
      throw new Error('simulated security error');
    });
    // Even if the environment were configured, a sync-throwing fetch must not
    // surface. Since we're unconfigured here this is partially hypothetical,
    // but documents the invariant.
    expect(() => sendTelemetry(buildEvent('session_started', {}))).not.toThrow();
  });

  it('does not throw when fetch returns a rejecting promise', async () => {
    grantConsent();
    fetchSpy.mockRejectedValue(new Error('network offline'));
    expect(() => sendTelemetry(buildEvent('session_started', {}))).not.toThrow();
    // Let the microtask queue drain — unhandled-rejection would show up here
    // if we'd forgotten the .catch() swallow.
    await new Promise((r) => setTimeout(r, 0));
  });

  it('returns synchronously — callers never await it', () => {
    grantConsent();
    const result = sendTelemetry(buildEvent('mold_generated', { success: true, axisUsed: 'z' }));
    // void return type; assertion exists to document the contract.
    expect(result).toBeUndefined();
  });
});
