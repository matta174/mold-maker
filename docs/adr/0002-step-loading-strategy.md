# ADR-0002: STEP export — lazy-load on first click, no prefetch

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** @matthewc174
**Supersedes:** none
**Referenced by:** ADR-0001 §"Pinned API gotchas", task #27

## Context

ADR-0001 committed us to `opencascade.js` for STEP export knowing the 66 MB WASM binary was the single biggest cost of the decision. That ADR deferred the loading-strategy question to this one: now that the feature is implemented (tasks #25, #26), how do those bytes reach the user, and when?

The relevant baselines to frame the honest size delta:

| Asset | Baseline (pre-STEP) | After STEP |
|-------|---------------------|------------|
| Main bundle (`index-*.js`) | ~1.1 MB | 1.15 MB (318 KB gzip) |
| Manifold worker chunk | 151 KB | 151 KB (unchanged) |
| Manifold WASM | 493 KB (192 KB gzip) | 493 KB (unchanged) |
| **STEP worker chunk** | — | **298 KB** |
| **OpenCascade WASM** | — | **65.86 MB (13.98 MB gzip)** |

Numbers are from `vite build` on 2026-04-20 at commit HEAD. Reproducible with `npx vite build --outDir /tmp/mm-dist --emptyOutDir`.

Two interesting readings of that table:

1. **The main bundle did not grow.** The STEP export worker is a separate Vite chunk and the OCP WASM is a separate asset — neither is pulled into `index-*.js`. Users who never click STEP download exactly what they downloaded before the feature shipped.
2. **The STEP cost, when paid, is real.** 14 MB gzipped WASM + 298 KB worker JS is roughly 2× the entire rest of the app. That's unavoidable with OCCT; the competitive set (FreeCAD-in-browser, etc.) carries similar or larger costs. Option B in ADR-0001 ("hand-rolled STEP writer") would have avoided this but failed on compliance-risk grounds already litigated there.

Vite achieved the chunk split automatically because:
- The STEP worker is spawned via the Vite-native pattern `new Worker(new URL('./stepExportWorker.ts', import.meta.url), { type: 'module' })`, which Rollup treats as an entry point.
- `opencascade.js` is loaded inside `stepExporter.ts` via `await import('opencascade.js/dist/opencascade.wasm.js')`, which Rollup treats as a dynamic import and code-splits.
- The OCP WASM binary itself is fetched at runtime via `fetch(new URL(...wasm, import.meta.url))` — Vite copies the binary to `/assets/` and rewrites the URL.

So "lazy-load" isn't a new strategy we need to implement — it's the current state. The question this ADR answers is whether to change it.

## Decision

**Keep the current strategy: lazy-load on first STEP-button click, no prefetch, no warming.** The OCP WASM download happens inside the spawned `stepExportWorker` the first time the user clicks STEP. Subsequent STEP exports reuse the cached module.

## Options Considered

### Option A (chosen): Lazy-load on first click

The user pays zero bytes for STEP until they click the STEP button. First click spawns the worker, worker pulls the 14 MB gzipped WASM, worker initialises OCP, exportSTEP runs. On a 50 Mbps connection, first-click-to-ready is ~3 seconds of download + ~1 second of WASM init. All subsequent clicks in the same session reuse the loaded module.

**Pros:**
- Zero impact on users who never use STEP — the feature is functionally invisible on bandwidth until asked for.
- Matches the "everything runs locally, nothing leaves your machine" positioning in launch messaging (docs/launch/show-hn.md): the 66 MB download is a user-initiated event they can see and rationalise ("ah, that's the CAD engine"), not a silent hit on app open.
- Worker isolation means a STEP load failure leaves the rest of the app fully functional. Error handling (ADR-0001 §29 → `stepExportErrors.ts`) already translates the failure to a user-actionable message.

**Cons:**
- First-click wait is ~3-10 seconds on typical broadband, longer on slow connections. The UI shows "Exporting STEP…" during this window (via the existing `stepExporting` state in ControlPanel) — the user sees SOMETHING is happening, but they can't distinguish "downloading" from "processing".

### Option B: Prefetch on app idle

Wait for the app to be idle for some threshold (say, 30 seconds after last user interaction), then spawn the STEP worker in the background to warm the cache. First real STEP click then finds the WASM already loaded.

**Pros:**
- Snappier first STEP export — the 3-10 second download moves out of the user's blocking path.

**Cons:**
- Costs 14 MB on every session where the user never ends up using STEP. Metered connections, battery, data-caps — this is rude for a free tool with no business model that would justify it. Particularly bad for users who opened the app to export STL and got their bandwidth silently eaten on a feature they didn't ask for.
- Undermines the user-initiated-download framing that makes the 66 MB WASM tolerable as a cost. "I clicked STEP, it downloaded the engine" is fine. "I opened the app, it pulled down 14 MB of who-knows-what" is not.
- Telemetry (task #27 event `file_exported` with `format: 'step'`) will tell us what fraction of sessions actually use STEP. We can revisit if that fraction is very high (say, >60%) — prefetching is clearly worth it at that point. At launch we have zero data.

**Rejected:** opt-in cost model is the right default for a 14 MB payload. Revisit when telemetry tells us the use rate.

### Option C: Show download progress during first load

Instead of the current uninformative "Exporting STEP…" button label, intercept the WASM fetch and show "Downloading STEP engine… X MB / 14 MB" during first load, switching to "Exporting STEP…" once the mesh work starts.

**Pros:**
- Materially better UX on the first-click wait — the user knows the app isn't frozen.
- No bandwidth cost change vs. Option A.

**Cons:**
- Requires refactoring the OCP loader to use a `fetch` with a stream and a ReadableStream progress loop, PLUS plumbing progress events from the worker back to the main thread through a new message type in the protocol.
- The 1.1.1 package loader pattern (`Factory({ wasmBinary })`) wants a completed buffer, not a stream — we'd need to read the whole stream first, counting bytes as we go, then hand the buffer to the Factory.
- Moderate implementation cost; not strictly load-strategy work, more UX work.

**Deferred:** if first-impression user feedback flags the silent 3-10s wait as broken, implement C as a follow-up. Not blocking launch.

## Trade-off Analysis

The decision boils down to one honest question: **who are we optimising for?**

| Optimisation target | Best option |
|---------------------|-------------|
| Non-STEP users (probably majority at launch) | A — they pay nothing |
| First-time STEP users | C — they see what's happening |
| Repeat STEP users | Any — cache hits after first load |
| Bandwidth-constrained users | A — no surprise downloads |

At launch, with zero usage data and a user base of "3D-printing hobbyists on Show HN / r/3Dprinting / r/3Dprintmolds", the weight on "don't surprise people with a 14 MB download" is high. A is the conservative, revisitable default.

## Consequences

**Becomes easier:**
- No additional code to write. The current architecture already implements A.
- Telemetry gathering for task #30 — if `file_exported: step` count turns out to be a meaningful fraction of sessions, we have permission to revisit B.

**Becomes harder:**
- Nothing. We're accepting the status quo.

**Revisit if:**
- Telemetry shows STEP is used in >50% of sessions with a successful generate → strong signal that prefetch (B) pays off.
- User feedback on Show HN / launch threads flags the first-click wait as broken → implement progress UI (C).
- `opencascade.js` v2.x ships with smaller default WASM (the "slim" build flag) → the whole calculation shifts.

## Follow-on items

1. [x] Record baseline numbers above so future builds can be compared. (Done — this ADR.)
2. [ ] After 2 weeks of telemetry, revisit the `file_exported: step` rate and decide whether B is warranted (add to roadmap under "launch+2w review").
3. [ ] If user feedback flags the first-click wait, spike Option C as a 1-day task.

## Pinned numbers for future regression-checks

Main bundle delta before/after STEP shipped: **+50 KB uncompressed** in `index-*.js` (handful of small modules: `stepExportErrors.ts`, imports, the STEP-format enum, the STEP button in `ControlPanel`). The 50 KB delta is acceptable — it is the *integration* of STEP, not STEP itself. If this number ever grows significantly without a corresponding PR that explicitly touches STEP, something has leaked the OCP binding into the main bundle.

OCP WASM size: **65.86 MB raw, 13.98 MB gzipped.** v1.1.1. If this shifts more than ±5% between builds without an `opencascade.js` version bump, investigate — it probably means a Vite config change is pulling something unexpected into the asset.
