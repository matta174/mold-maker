/**
 * useTelemetry — thin React wrapper around the pure transport + settings.
 *
 * Exists for two reasons:
 *   1. Give App.tsx one import instead of three, with stable callback identity
 *      so the keyboard-shortcut effect doesn't churn its dependency array.
 *   2. Track consent-needed state reactively so the FirstRunTelemetryModal can
 *      appear immediately after `grantConsent()` / `declineConsent()` without
 *      a page reload.
 *
 * Not a zustand store, not a context — this is a single-user preference that
 * lives in localStorage. A useState + useCallback is sufficient, and keeps
 * the feature opt-outable by code review: rip out the import, rip out the
 * effect, the app still works.
 */

import { useCallback, useState } from 'react';
import type { EventName, TelemetryEventPayload } from './telemetryEvents';
import { sendTelemetry, telemetryIsConfigured } from './telemetryTransport';
import {
  declineConsent as declineConsentInStorage,
  grantConsent as grantConsentInStorage,
  loadSettings,
  needsConsent,
  type TelemetrySettings,
} from './telemetrySettings';

export interface UseTelemetryApi {
  /** Fire an event. No-op if disabled / unconfigured. Never throws. */
  send: <N extends EventName>(event: TelemetryEventPayload<N>) => void;
  /** True if we still need to show the consent modal for this user. Becomes
   *  false after grant() OR decline() — both count as "user was asked." */
  needsConsent: boolean;
  /** True if the build was shipped with a telemetry host + website ID. Lets
   *  the UI hide the toggle entirely on un-configured forks. */
  configured: boolean;
  /** User opted in — persists and updates reactive state. */
  grant: () => void;
  /** User declined — persists (so we don't re-ask) and updates reactive state. */
  decline: () => void;
  /** Current settings snapshot for UI display (last-consent date, etc). */
  settings: TelemetrySettings;
}

export function useTelemetry(): UseTelemetryApi {
  const [settings, setSettings] = useState<TelemetrySettings>(() => loadSettings());

  const send = useCallback(<N extends EventName>(event: TelemetryEventPayload<N>) => {
    sendTelemetry(event);
  }, []);

  const grant = useCallback(() => {
    const next = grantConsentInStorage();
    setSettings(next);
  }, []);

  const decline = useCallback(() => {
    const next = declineConsentInStorage();
    setSettings(next);
  }, []);

  return {
    send,
    needsConsent: needsConsent(settings),
    configured: telemetryIsConfigured(),
    grant,
    decline,
    settings,
  };
}
