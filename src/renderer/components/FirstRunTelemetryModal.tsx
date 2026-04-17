import { useEffect } from 'react';
import { colors, radii, spacing, fontSizes } from '../theme';

/**
 * First-run telemetry consent modal.
 *
 * Triggered from App.tsx AFTER the user's first successful mold generation —
 * never on launch. The reasoning is documented in
 * .auto-memory/project_telemetry_design.md: asking for consent before the
 * product has delivered value is the equivalent of a panhandler asking for
 * money before you've decided you want to talk to them. A user who has just
 * watched their mold generate is in a position to make an informed ask.
 *
 * UX rules this modal follows:
 * - NO auto-timeout. Consent shouldn't be gamified by "make the decision in
 *   10 seconds or we'll close this and implicitly opt you out."
 * - Explicit buttons only. Allow → grantConsent; Not Now → declineConsent.
 *   Backdrop click and Escape both close-without-deciding (modal will re-
 *   appear on the NEXT successful mold generation, max ~3 times before most
 *   users commit either way — not ideal, but less bad than treating
 *   ambiguous dismissal as a decision).
 * - Every event named on-screen, with the product question it answers. If a
 *   reader can't see exactly what gets sent, that's a trust failure.
 * - "What we do NOT collect" section is explicit. Negative space matters.
 *
 * This component is presentational — the data-plane (grant / decline / settings
 * state) lives in the caller via useTelemetry, passed in as callbacks.
 */
export interface FirstRunTelemetryModalProps {
  /** User pressed "Allow anonymous telemetry". */
  onAllow: () => void;
  /** User pressed "Not Now" — record decline so we don't re-ask. */
  onDecline: () => void;
  /** Escape / backdrop — close modal, leave decision undecided. */
  onDismiss: () => void;
}

export default function FirstRunTelemetryModal({
  onAllow,
  onDecline,
  onDismiss,
}: FirstRunTelemetryModalProps) {
  useEffect(() => {
    // Escape = dismiss. We do NOT make Escape a decline — the user hasn't
    // clicked a consent-choice button, so we don't treat a keyboard close as
    // a recorded preference. Comes back next time the consent moment fires.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="telemetry-modal-title"
      onClick={onDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.panelBg,
          border: `1px solid ${colors.borderPanel}`,
          borderRadius: radii.lg,
          padding: `${spacing.xl}px ${spacing.xl + spacing.sm}px`,
          color: colors.textPrimary,
          minWidth: 440,
          maxWidth: 560,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div
          id="telemetry-modal-title"
          style={{
            fontSize: fontSizes.lg,
            fontWeight: 600,
            marginBottom: spacing.md,
          }}
        >
          Help shape Mold Maker?
        </div>

        <p style={{ fontSize: fontSizes.sm, color: colors.textBody, marginBottom: spacing.lg, lineHeight: 1.5 }}>
          You just generated your first mold. Nice. Would you let this app send
          <strong style={{ color: colors.textPrimary }}> five anonymous usage events</strong> so
          the project can prioritize what to build next with data instead of guesses?
        </p>

        <div style={{
          background: colors.sectionBg,
          border: `1px solid ${colors.borderSection}`,
          borderRadius: radii.md,
          padding: `${spacing.md}px ${spacing.lg}px`,
          marginBottom: spacing.lg,
        }}>
          <div style={{ fontSize: fontSizes.sm, fontWeight: 600, marginBottom: spacing.sm, color: colors.textPrimary }}>
            What gets sent
          </div>
          <ul style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.xs,
            fontSize: fontSizes.xs,
            color: colors.textBody,
          }}>
            <EventRow name="session_started" question="Is the app being used at all?" />
            <EventRow name="model_loaded" question="Do users get past the import step?" />
            <EventRow name="mold_generated" question="Does mold generation succeed, and on which axis?" />
            <EventRow name="plane_auto_detected" question="Is auto-detect useful, or do users override it?" />
            <EventRow name="file_exported" question="Which export formats actually matter?" />
          </ul>
        </div>

        <div style={{
          background: 'rgba(80,40,40,0.2)',
          border: `1px solid ${colors.borderSection}`,
          borderRadius: radii.md,
          padding: `${spacing.md}px ${spacing.lg}px`,
          marginBottom: spacing.lg,
        }}>
          <div style={{ fontSize: fontSizes.sm, fontWeight: 600, marginBottom: spacing.sm, color: colors.textPrimary }}>
            What does NOT get sent
          </div>
          <div style={{ fontSize: fontSizes.xs, color: colors.textBody, lineHeight: 1.5 }}>
            File names, file contents, mesh data, triangle counts, bounding-box sizes, file
            paths, your IP address (beyond what any web request inherently reveals, which the
            server drops), or anything identifying about you or your model. Event data is
            limited by TypeScript types to simple flags like success/failure and axis names.
          </div>
        </div>

        <div style={{ fontSize: fontSizes.xs, color: colors.textDim, marginBottom: spacing.lg, lineHeight: 1.5 }}>
          You can change your mind any time in the control panel. If you decline, we won't
          ask again. Full details in the PRIVACY.md file shipped with this app.
        </div>

        <div style={{ display: 'flex', gap: spacing.md, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onDecline}
            style={{
              background: 'transparent',
              color: colors.textPrimary,
              border: `1px solid ${colors.borderPanel}`,
              borderRadius: radii.md,
              padding: `${spacing.sm}px ${spacing.lg}px`,
              fontSize: fontSizes.sm,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            aria-label="Decline telemetry"
          >
            Not Now
          </button>
          <button
            type="button"
            onClick={onAllow}
            style={{
              background: colors.primary,
              color: colors.textPrimary,
              border: 'none',
              borderRadius: radii.md,
              padding: `${spacing.sm}px ${spacing.lg}px`,
              fontSize: fontSizes.sm,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            aria-label="Allow anonymous telemetry"
            autoFocus
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

/** Single "event_name — the question it answers" row in the disclosure list. */
function EventRow({ name, question }: { name: string; question: string }) {
  return (
    <li style={{ display: 'flex', gap: spacing.sm, alignItems: 'baseline' }}>
      <code style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: fontSizes.xs,
        color: colors.primary,
        whiteSpace: 'nowrap',
      }}>
        {name}
      </code>
      <span style={{ color: colors.textDim }}>—</span>
      <span>{question}</span>
    </li>
  );
}
