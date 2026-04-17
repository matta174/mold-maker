# Privacy Notice

Mold Maker is designed to be offline-capable and to respect your data. This document describes, precisely, what the app can and cannot send about you, and how to control it.

If you ever find this document out of step with the code, treat the code as authoritative and please open an issue.

## TL;DR

- Telemetry is **off by default**. Nothing leaves your machine unless you explicitly turn it on.
- If you opt in, the app sends **five anonymous events** over the network. Nothing else.
- No file contents, no file names, no mesh data, no bounding-box sizes, no file paths, no IP-address linking, no identifiers.
- You can change your mind any time in the Control Panel → Privacy section.
- Open-source forks that aren't configured with a telemetry host cannot send anything at all — not because of the opt-in toggle, but because the browser's Content Security Policy blocks it at the network layer.

## What gets sent when you opt in

Exactly these five events, and only the properties listed:

| Event | Properties | What question it answers |
|---|---|---|
| `session_started` | *none* | Is the app being used at all? |
| `model_loaded` | `success: boolean`, `failureReason?` (`parse_error` / `non_manifold` / `csg_failed` / `empty_result` / `unknown`) | Do users get past the import step? |
| `mold_generated` | `success`, `axisUsed` (`x`/`y`/`z`), `failureReason?` | Does mold generation succeed, and on which axis? |
| `plane_auto_detected` | `success`, `axisDetected?` | Is auto-detect useful, or do users override it? |
| `file_exported` | `format` (`stl`/`obj`/`3mf`) | Which export formats actually matter? |

The schema for these events lives in [`src/renderer/services/telemetryEvents.ts`](./src/renderer/services/telemetryEvents.ts). Property values are restricted by TypeScript types to `string`, `number`, or `boolean`, and the failure-reason field is a closed enum — there's no free-form string anywhere in the event shape, which is the most common place PII leaks (error messages that contain paths or usernames).

## What does NOT get sent

- **File names.** Not the open file, not the export name.
- **File contents or mesh data.** No vertices, no triangles, no bounding-box dimensions, no vertex counts.
- **File paths.** Not the load path, not the export destination, not the app install location.
- **Identifying information.** No user name, no email, no machine ID, no install ID, no session ID beyond what the analytics server itself generates.
- **Location or language.** We explicitly send empty `language` and `screen` fields to the analytics server to suppress its default auto-collection.
- **Raw error messages.** When something fails, we send a coarse enum tag (`csg_failed`, `parse_error`, etc.), not the exception text, because exception text is where paths and names tend to leak.

## Where the data goes

When enabled, events are sent to a self-hosted [Umami](https://umami.is/) analytics instance at a URL that is hardcoded at build time. No third-party analytics vendor is involved. The build's Content Security Policy (`connect-src`) is locked to that exact host, so the app cannot send data anywhere else even if a dependency is compromised.

If you're building Mold Maker from source without setting the `VITE_TELEMETRY_HOST` environment variable, the resulting build has **no telemetry host at all** — the Privacy section in the app is invisible, events are silently dropped in the transport layer, and the CSP's `connect-src` remains `'self' blob:` which makes phoning home architecturally impossible.

The server drops the sender's IP address before storing events. No cross-event linking, no user profiles.

## How to opt in, opt out, or change your mind

- **First prompt:** After your first successful mold generation, a one-time modal asks whether you'd like to help. Allow / Not Now / Dismiss (Esc or backdrop).
  - **Allow** — telemetry starts sending immediately.
  - **Not Now** — we record that you declined and never ask again.
  - **Dismiss** — no decision is recorded; you'll see the modal again the next time you generate a mold.
- **Later changes:** Control Panel → Privacy → toggle "Anonymous usage data." The toggle reflects the current state and flips it cleanly. This is available any time the app is running, not gated on having generated a mold.
- **Deleting prior consent:** The consent state lives in `localStorage` under the key `mold-maker-telemetry`. Clearing your browser's site storage (or deleting Electron's `Local Storage` directory) resets the app to "never prompted."

## Consent versioning

If the data-collection scope ever changes in a way that invalidates prior consent, we bump `CONSENT_VERSION` in [`telemetrySettings.ts`](./src/renderer/services/telemetrySettings.ts). On the next launch after a version bump, the app treats you as un-prompted and re-asks — your previous "yes" to v1 doesn't silently roll forward into v2. (Your previous "no" remains honored until you actively change it.)

## Why have telemetry at all

Mold Maker's roadmap priorities are currently driven by one developer's intuition and a single competitive analysis. That's not a reliable basis for deciding what to build next. Five coarse, opt-in events tell us enough to answer questions like "does anyone actually use STEP export?" or "which axis dominates?" — which then feeds directly into what ships next.

The alternative to telemetry isn't "more privacy for everyone"; it's "features built on guesswork." This is our attempt at the middle path: answer those questions from real usage data, from users who chose to share it, with as little surface area as possible.

## Changelog

- **v1 (2026-04-16)** — Initial privacy notice. Five launch events, self-hosted Umami, off-by-default, documented consent-version field so future changes re-prompt.
