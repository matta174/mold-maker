import { describe, it, expect, beforeEach } from 'vitest';

// Install an in-memory localStorage mock BEFORE importing the module under test.
// Rationale: happy-dom 15.x + Node 25.x have a nasty interaction — Node 25's
// experimental native `localStorage` (gated on the `--localstorage-file` flag)
// shadows happy-dom's DOM localStorage, and without the flag the native one
// silently no-ops. The symptoms are exactly what we saw: some calls throw
// "setItem is not a function", others "succeed" but fail to round-trip.
//
// This mock is environment-agnostic and sidesteps the whole mess — the module
// under test only does runtime `typeof localStorage` checks, so swapping the
// global here is sufficient.
const _store = new Map<string, string>();
const mockLocalStorage: Storage = {
  get length() {
    return _store.size;
  },
  clear: () => _store.clear(),
  getItem: (k: string) => (_store.has(k) ? _store.get(k)! : null),
  key: (i: number) => Array.from(_store.keys())[i] ?? null,
  removeItem: (k: string) => {
    _store.delete(k);
  },
  setItem: (k: string, v: string) => {
    _store.set(k, String(v));
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

import {
  CONSENT_VERSION,
  declineConsent,
  grantConsent,
  loadSettings,
  needsConsent,
  saveSettings,
  __resetForTests,
} from './telemetrySettings';

/**
 * Settings storage is privacy-critical — if this module silently misbehaves,
 * we either leak events from un-consented users OR lose a consent choice and
 * re-nag forever. Both are product-quality bugs and both erode trust. These
 * tests exercise the boundaries that matter: fresh install, round-trip,
 * malformed blobs, version bumps.
 */
describe('telemetrySettings', () => {
  beforeEach(() => {
    // Clear the underlying store explicitly — __resetForTests() does the right
    // thing in product code, but belt-and-braces here catches any test that
    // stashed other keys into the same store.
    _store.clear();
    __resetForTests();
  });

  describe('loadSettings', () => {
    it('returns conservative defaults on fresh install', () => {
      const s = loadSettings();
      expect(s.telemetryEnabled).toBe(false);
      expect(s.lastConsent).toBeNull();
      expect(s.consentVersion).toBeNull();
    });

    it('round-trips saved settings', () => {
      const stamped = {
        telemetryEnabled: true,
        lastConsent: '2026-04-16T12:00:00.000Z',
        consentVersion: CONSENT_VERSION,
      };
      saveSettings(stamped);
      expect(loadSettings()).toEqual(stamped);
    });

    it('falls back to defaults when stored JSON is malformed', () => {
      // Directly poison the storage slot with a non-JSON blob.
      localStorage.setItem('mold-maker-telemetry', '{not-valid-json');
      const s = loadSettings();
      expect(s.telemetryEnabled).toBe(false);
      expect(s.consentVersion).toBeNull();
    });

    it('defensively coerces partial/incorrect fields to safe defaults', () => {
      // A blob where someone's hand-edit or an older schema version produced
      // wrong-type fields. We never want a stray "enabled: 'yes'" string to
      // coerce to a truthy telemetryEnabled.
      localStorage.setItem(
        'mold-maker-telemetry',
        JSON.stringify({ telemetryEnabled: 'yes', lastConsent: 12345, consentVersion: 'v1' }),
      );
      const s = loadSettings();
      expect(s.telemetryEnabled).toBe(false);
      expect(s.lastConsent).toBeNull();
      expect(s.consentVersion).toBeNull();
    });
  });

  describe('grantConsent / declineConsent', () => {
    it('grant flips enabled on and stamps version + ISO time', () => {
      const s = grantConsent();
      expect(s.telemetryEnabled).toBe(true);
      expect(s.consentVersion).toBe(CONSENT_VERSION);
      // ISO 8601 — cheap regex is enough to catch "forgot to call toISOString".
      expect(s.lastConsent).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // Persists — next load returns the same thing.
      expect(loadSettings()).toEqual(s);
    });

    it('decline persists so we do not re-prompt every launch', () => {
      const s = declineConsent();
      expect(s.telemetryEnabled).toBe(false);
      // Crucial: consentVersion is stamped even on decline. Without this, the
      // user would see the consent modal on every subsequent mold generation.
      expect(s.consentVersion).toBe(CONSENT_VERSION);
      expect(s.lastConsent).not.toBeNull();
      expect(loadSettings()).toEqual(s);
    });
  });

  describe('needsConsent', () => {
    it('is true for a never-prompted user', () => {
      expect(needsConsent(loadSettings())).toBe(true);
    });

    it('is false after grant', () => {
      grantConsent();
      expect(needsConsent(loadSettings())).toBe(false);
    });

    it('is false after decline (decline still counts as "was asked")', () => {
      declineConsent();
      expect(needsConsent(loadSettings())).toBe(false);
    });

    it('is true again when the stored consentVersion is older than current', () => {
      // Simulate a user who consented under v1; now we've bumped to v2.
      saveSettings({
        telemetryEnabled: true,
        lastConsent: '2026-01-01T00:00:00.000Z',
        consentVersion: CONSENT_VERSION - 1,
      });
      expect(needsConsent(loadSettings())).toBe(true);
      // And their enabled state is preserved on disk — we just re-prompt.
      // The re-prompt flow elsewhere decides whether to respect prior opt-in
      // or treat the version bump as a fresh decision.
      expect(loadSettings().telemetryEnabled).toBe(true);
    });
  });
});
