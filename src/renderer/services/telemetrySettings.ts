/**
 * Telemetry settings storage.
 *
 * Persists the user's opt-in state across sessions via localStorage. This is
 * intentionally a pure module (no React) so event-firing code paths don't need
 * to be inside a component tree to check "is telemetry on?".
 *
 * Design decisions (see .auto-memory/project_telemetry_design.md for context):
 * - Opt-in, OFF by default. Schema carries a `consentVersion` so a future
 *   privacy-policy change can re-prompt without losing the fact that a prior
 *   consent happened.
 * - localStorage (not IndexedDB, not Electron userData JSON). These are public
 *   non-sensitive preferences; the complexity of async IndexedDB or IPC isn't
 *   worth it. If Electron packaging later switches to file:// with per-origin
 *   isolation, this key gets scoped automatically — that's fine.
 * - Silent failure: if localStorage is unavailable (e.g. SSR, private-browsing
 *   iframe), load() returns defaults and save() no-ops. Telemetry MUST NOT be
 *   the thing that breaks app startup.
 */

/** Bump when the privacy notice or data-collection scope changes in a way that
 *  invalidates prior consent. v1 = launch (5 events, no PII, self-hosted Umami). */
export const CONSENT_VERSION = 1;

const STORAGE_KEY = 'mold-maker-telemetry';

export interface TelemetrySettings {
  /** User has explicitly opted in. Default false = never sent. */
  telemetryEnabled: boolean;
  /** ISO timestamp of the last explicit consent action. Null = never prompted. */
  lastConsent: string | null;
  /** Which consent version the user agreed to. Null = never prompted. If this
   *  doesn't match CONSENT_VERSION at runtime, we treat the user as un-prompted
   *  (re-prompt on the next consent-moment trigger) rather than silently auto-
   *  carrying stale consent across policy changes. */
  consentVersion: number | null;
}

const DEFAULTS: TelemetrySettings = {
  telemetryEnabled: false,
  lastConsent: null,
  consentVersion: null,
};

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    // Some browsers throw on property access when storage is blocked.
    return false;
  }
}

/** Read settings from localStorage, falling back to defaults for missing keys
 *  or malformed JSON. Never throws. */
export function loadSettings(): TelemetrySettings {
  if (!hasLocalStorage()) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // Defensive merge — a malformed blob shouldn't crash startup, and missing
    // fields should fall back to the conservative default (off).
    return {
      telemetryEnabled: typeof parsed.telemetryEnabled === 'boolean' ? parsed.telemetryEnabled : false,
      lastConsent: typeof parsed.lastConsent === 'string' ? parsed.lastConsent : null,
      consentVersion: typeof parsed.consentVersion === 'number' ? parsed.consentVersion : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persist settings. Never throws; localStorage quota errors or unavailability
 *  are silently swallowed — losing a preference is strictly better than a
 *  surfaced error for a privacy-infrastructure module. */
export function saveSettings(settings: TelemetrySettings): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Intentional no-op: quota exceeded, storage disabled, etc.
  }
}

/** User has just opted in via the consent modal. Stamps a consent version + ISO
 *  time so we can re-prompt on policy changes. */
export function grantConsent(): TelemetrySettings {
  const settings: TelemetrySettings = {
    telemetryEnabled: true,
    lastConsent: new Date().toISOString(),
    consentVersion: CONSENT_VERSION,
  };
  saveSettings(settings);
  return settings;
}

/** User has declined OR opted out. We remember that they were prompted (so we
 *  don't re-ask on every launch) but telemetryEnabled is off. */
export function declineConsent(): TelemetrySettings {
  const settings: TelemetrySettings = {
    telemetryEnabled: false,
    lastConsent: new Date().toISOString(),
    consentVersion: CONSENT_VERSION,
  };
  saveSettings(settings);
  return settings;
}

/** True if we haven't prompted this user for the CURRENT consent version yet. */
export function needsConsent(settings: TelemetrySettings): boolean {
  return settings.consentVersion !== CONSENT_VERSION;
}

/** Test-only utility. Resets the stored state as if a fresh install. */
export function __resetForTests(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}
