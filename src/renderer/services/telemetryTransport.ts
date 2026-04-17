/**
 * Telemetry transport — fire-and-forget POST to the Umami endpoint.
 *
 * Three non-negotiable rules for this module:
 *   1. Never throw. Telemetry failing silently is strictly better than an
 *      uncaught rejection surfacing in the console (or worse, React's error
 *      boundary). This is infrastructure code for a privacy feature; if it
 *      breaks, the product must keep working.
 *   2. Never block. No await chains in UI code paths — the caller gets
 *      synchronous control back immediately; network I/O happens in the
 *      background. A user clicking "Generate Mold" must never wait on an
 *      analytics ping.
 *   3. Never send when disabled. The opt-in check runs here as a defence in
 *      depth — even if a caller forgets to check, we refuse. Combined with the
 *      CSP hardening (connect-src locked to a single host), this means "off"
 *      is enforced at three layers: UI toggle → this gate → browser CSP.
 *
 * We read the Umami host from `import.meta.env.VITE_TELEMETRY_HOST` at build
 * time. If unset, sendTelemetry is a no-op — useful for dev builds and for
 * self-builders who don't want to run their own analytics server.
 *
 * Umami custom-event wire format: POST to `${host}/api/send` with JSON body
 *   { type: 'event', payload: { website, name, data, hostname, language: '', screen: '' } }
 * We intentionally send empty `language` and `screen` to suppress Umami's
 * auto-collected fingerprint-adjacent fields. Hostname is fixed to the app
 * domain rather than the referrer.
 */

import type { EventName, TelemetryEventPayload } from './telemetryEvents';
import { loadSettings } from './telemetrySettings';

/** Endpoint host, injected at build time. Empty string = disabled. */
const TELEMETRY_HOST: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_TELEMETRY_HOST?: string } }).env?.VITE_TELEMETRY_HOST) ||
  '';

/** Umami website ID. Also build-time; same "empty = disabled" semantics. */
const TELEMETRY_WEBSITE_ID: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_TELEMETRY_WEBSITE_ID?: string } }).env?.VITE_TELEMETRY_WEBSITE_ID) ||
  '';

/** Fixed hostname tag. Umami wants *something* in the hostname field; we don't
 *  want to leak the user's origin (could be localhost, could be an Electron
 *  file://, could be a self-host domain). A constant makes all events
 *  indistinguishable on that axis. */
const TELEMETRY_HOSTNAME_TAG = 'mold-maker.app';

/** Hard timeout — if the server is slow, we'd rather drop the event than keep
 *  a fetch pending. 5s is generous enough for flaky connections and short
 *  enough that nothing piles up. */
const REQUEST_TIMEOUT_MS = 5000;

/** True only if the build has both host and website-id configured. A half-
 *  configured build behaves as disabled — we never want to ship a binary that
 *  sends to "undefined" paths. */
function isConfigured(): boolean {
  return TELEMETRY_HOST.length > 0 && TELEMETRY_WEBSITE_ID.length > 0;
}

/** True if the user has explicitly opted in AND the build is configured. The
 *  ORDER matters: we check config first so dev builds short-circuit without
 *  touching localStorage. */
function isEnabled(): boolean {
  if (!isConfigured()) return false;
  const settings = loadSettings();
  return settings.telemetryEnabled === true;
}

/**
 * Send a telemetry event. Returns immediately. Does not throw. Does not log
 * on failure (a noisy console in production is a bug, not a feature).
 *
 * Callers should not await this — it's typed as void on purpose. If you find
 * yourself wanting to know whether a send succeeded, stop: the design premise
 * is that the caller doesn't care. Delivery is best-effort.
 */
export function sendTelemetry<N extends EventName>(event: TelemetryEventPayload<N>): void {
  // Defence in depth — any of these bailing out is a valid, expected path.
  if (!isEnabled()) return;
  if (typeof fetch !== 'function') return;

  const body = JSON.stringify({
    type: 'event',
    payload: {
      website: TELEMETRY_WEBSITE_ID,
      name: event.name,
      data: event.data,
      hostname: TELEMETRY_HOSTNAME_TAG,
      // Intentionally empty — suppress Umami's auto-collected fields that
      // would contribute to a fingerprint. The type system won't enforce
      // this downstream, so it's an operational choice we document here.
      language: '',
      screen: '',
    },
  });

  // AbortController lets us enforce a timeout even if fetch() would otherwise
  // hang indefinitely (common with Umami behind a flaky reverse proxy).
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          /* no-op */
        }
      }, REQUEST_TIMEOUT_MS)
    : null;

  try {
    fetch(`${TELEMETRY_HOST}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // credentials: 'omit' — don't send cookies. Umami self-host sometimes
      // sets a session cookie that we explicitly don't want to participate in.
      credentials: 'omit',
      signal: controller?.signal,
      // keepalive lets the request survive a page navigation / window close,
      // which matters for `file_exported` fired at the tail of a user action.
      keepalive: true,
    })
      .catch(() => {
        /* swallow network errors — abort, DNS fail, offline, CSP block */
      })
      .finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
      });
  } catch {
    // fetch() itself throwing synchronously (very rare — bad URL format,
    // security error in some runtimes). Still swallowed.
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

/** Exposed for tests / diagnostics / about-page. Returns `false` both when the
 *  build is unconfigured and when the user is opted out — a caller asking
 *  "will the next sendTelemetry actually send?" gets the honest answer. */
export function telemetryIsActive(): boolean {
  return isEnabled();
}

/** Exposed for the privacy notice UI — lets the consent modal reveal whether
 *  the app was even built with a telemetry endpoint (open-source forks may
 *  not be, which is a valid and explicit outcome). */
export function telemetryIsConfigured(): boolean {
  return isConfigured();
}
