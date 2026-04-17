# Roadmap

Mold Maker is an open-source, offline-capable, two-part mold generator. This doc lays out what we're building, in what order, and why. It's a communication tool — dates slip, priorities shift, contributors show up and change the math. Treat it as a compass, not a Gantt chart.

If you're new here, the short version: **we want to be the Meshmixer successor for mold prep** — free, local, hackable, with enough specialized features that nobody has to drop into Fusion 360 for basic mold work.

Contributions are very welcome. See [How to Contribute](#how-to-contribute) at the bottom.

## Legend

- **Difficulty:** 🌱 Beginner-friendly · 🌿 Intermediate · 🌳 Advanced
- **Effort:** rough person-day estimate. Solo part-time velocity assumed.
- **Status:** Not Started · In Progress · Shipped

## What Ships Today

The current 1.0 release handles the core two-part mold workflow end to end:

- STL and OBJ input with a Three.js orbit-controlled 3D viewport
- Manual parting plane (X / Y / Z axis + position slider) or Auto-Detect
- Manifold-WASM CSG pipeline running in a Web Worker (responsive UI during generation)
- Auto-generated registration pins at the four corners, with clearance-fit holes in the mating half
- Auto-generated tapered sprue and up-to-four air vents at geometric extremities
- Scale-relative wall thickness (3-20%) and clearance (1-15%) as live UI sliders, with regenerate-detection if you adjust them after a build
- Exploded view and Show-Original toggles
- STL, OBJ, and 3MF export for each mold half separately
- Runs in the browser *or* as an Electron desktop app (fully offline)
- Keyboard-accessible UI with ARIA roles on controls
- Demoldability heatmap overlay — per-face classification (green / yellow / red) lets you see undercuts before running the CSG
- First-run polish: bundled procedural sample model, drag-and-drop STL/OBJ onto the viewport, keyboard shortcuts with a `?`-triggered cheat-sheet overlay
- Wireframe toggle in the viewport (`W` shortcut, also in the View panel) — inspect mesh topology on the loaded model *or* generated mold halves
- Opt-in anonymous telemetry (five coarse events, off by default, self-hosted Umami, CSP-locked to a single endpoint, full list in [PRIVACY.md](./PRIVACY.md)) — gives the project real usage data to replace guess-driven prioritization, without touching file contents, paths, or identifiers
- Auto-scale-to-printer — curated dropdown of common FDM/MSLA build plates (Bambu, Prusa, Ender, Elegoo, Anycubic), a fit readout that accounts for the mold walls (not just the part size), a polite *suggested* scale to make it fit, and a manual scale slider. Deliberately distinct from the competitor pattern of silently rescaling the model at export time — scale is visible, reversible, and never auto-applied.

What it doesn't do yet is where this roadmap comes in.

## Now (Active Focus)

*Empty as of 2026-04-16.* The three items this bucket opened with — wall thickness + clearance sliders, the demoldability heatmap, and first-run polish — have all shipped. The next focus has not been picked yet.

Candidates are in Next below, but honestly, it'd be more useful to let real users try the current build and tell us what they hit first rather than guess. If a specific item matters to you, **file an issue** — that's the loudest signal we have right now. Opt-in telemetry (now shipped) will start answering some of these questions with data instead of vibes, but only from users who volunteer the signal.

## Next (Soon)

Items we'll pick up once the Now list ships, or sooner if a contributor wants to tackle them.

### 4. STEP (.stp) export 🌳

**Effort:** ~10-14 days · **Status:** Not Started

Adds STEP export via `occt-import-js` or `opencascade.js`. Signals "prosumer-grade" to users who want to take a mold into FreeCAD / SolidWorks / Fusion or machine it on a CNC rather than print it.

Honest caveat: the OpenCascade WASM binary is ~10MB. We'd want this opt-in (load on first use, not eagerly). If nobody actually uses it we'd rather know before shipping the binary to everyone.

Dependencies: telemetry is already in place (see "What Ships Today"), and `file_exported` already records which format users pick — so by the time STEP lands we'll have baseline data on STL/OBJ/3MF split to compare against. If STEP adoption is dismal we'll know.

### 5. Oblique parting planes (cut angle) 🌿

**Effort:** ~5-7 days · **Status:** Not Started

Some parts have no good axis-aligned parting plane but one obvious oblique one. Add a cut-angle slider alongside axis + position. The CSG code already uses cutting-boxes, so we rotate the cutters instead of keeping them axis-aligned.

Gotcha: `getRegistrationPinPositions` in [`channelPlacement.ts`](./src/renderer/mold/channelPlacement.ts) hardcodes axis-aligned corners. That function needs updating to place pins on the rotated parting plane.

### 6. Mold box shape options: cylinder, rounded-rect 🌿

**Effort:** ~4-6 days · **Status:** Not Started

Circular parts (bottles, dials, buttons) get cleaner demolding from a cylindrical mold box. Jason Webb's OpenSCAD script had this in 2012; we should too. Manifold has cylinder primitives already.

## Later (On Our Radar)

Items that are valuable but not yet top priority. Order within this section is soft.

### 8. Non-planar (contour) splitting 🌳

**Effort:** ~15-25 days · **Status:** Not Started

The flashiest gap against paid competitor `moldmaker.vercel.app`. Sample the model along perpendicular slices, fit a smoothed 2D parting curve per slice, loft those into a parting surface, and use that as the CSG cutter.

Deliberately deprioritized below the demoldability heatmap (item 1) because the heatmap delivers most of the practical value for a fraction of the effort. Revisit this when users start asking for it by name.

### 9. Mesh repair for non-watertight inputs 🌳

**Effort:** ~10-15 days for "good enough" · **Status:** Not Started

`generateMold` currently throws when the input isn't a valid manifold. The error surfaces cleanly, but the user has no recovery path. True hole-filling and self-intersection fixing is genuinely hard — it's why Autodesk Netfabb is enterprise-priced. A first pass might just expose Manifold's `MERGE_TOLERANCE` as a user slider and point to external repair tools (PrusaSlicer, MeshLab) for worse cases.

### 10. Internationalization (i18n) 🌿

**Effort:** ~5-7 days · **Status:** Not Started

Extract all UI strings to a messages file, wire up `react-intl` or a lighter-weight alternative. Mold making is a global activity and English-only is a real barrier for non-English-speaking makers. No translations needed at first — just the scaffolding so native speakers can contribute them.

Note: the Printer Fit dropdown in the running app is an obvious near-term i18n target — printer names are international (Bambu, Prusa, Elegoo are global brands) but the surrounding labels and help text need extraction first.

## Not Planned (and Why)

Explicitly out of scope, so everyone knows not to expect it:

- **Cloud storage / user accounts.** The whole product thesis is offline + no-signup. Accounts would eat the differentiator.
- **AI text-to-3D generation.** Out of scope. We turn models *into* molds; model *creation* is a different problem. We'll happily accept imports from whatever AI tool the user prefers.
- **Paid tier / premium features.** The project is MIT-style open source. If you want to support the work, star the repo, file useful issues, contribute PRs, or sponsor. No feature paywalls.
- **Multi-part molds (3+ pieces).** Real multi-part mold design requires non-planar analysis of the whole part, not just one parting surface. It's an order of magnitude harder than two-part. Not happening unless someone with serious mold-design expertise champions it.
- **Mold flow / injection simulation.** Fusion 360 and Netfabb do this with teams of engineers. We're not competing there.
- **Direct slicer integration.** Slicers already import 3MF with metadata; we'll improve our 3MF output rather than write slicer plugins.

## How to Contribute

The short version: **pick an item from this roadmap (🌱 items are approachable for newcomers), open an issue to talk through your plan, then send a PR.** Full workflow — dev setup, project layout, PR expectations, code style — is in [CONTRIBUTING.md](./CONTRIBUTING.md).

### Labels we use on issues

- `good first issue` — 🌱 difficulty, well-scoped, safe to tackle without deep codebase knowledge
- `help wanted` — we'd love contribution here, any difficulty
- `design needed` — the engineering is tractable but the UX needs thinking through first
- `blocked` — waiting on something (upstream lib, decision, dependency)

### Don't see your idea here?

Open an issue describing the problem you're solving (not just the feature you want). The "why" helps us weigh it against what's already on this list.

## Revision History

- **2026-04-16** — Initial roadmap. Built from the competitive analysis in [`docs/competitive-analysis.md`](./docs/competitive-analysis.md). Now/Next/Later buckets with 12 items total plus explicit "not planned" section.
- **2026-04-16** — Shipped *Wall thickness & clearance sliders* (was Now #2). Moved to "What Ships Today"; remaining Now items renumbered.
- **2026-04-16** — Shipped *Demoldability heatmap overlay* (was Now #1). Per-face green/yellow/red classification with a viewport legend; toggle lives in the Parting Plane section so it's right next to the axis decision it informs. Moved to "What Ships Today"; remaining Now items renumbered.
- **2026-04-16** — Shipped *First-run polish* (was Now #1). Bundled procedural sample mushroom (deliberately designed to hit every heatmap classification), drag-and-drop file loading on the viewport, and keyboard shortcuts (`O` open, `G` generate, `A` auto-detect, `H` heatmap, `E` explode, `X`/`Y`/`Z` axis, `?` help, `Esc` close). Moved to "What Ships Today"; Now bucket is now empty pending the next focus decision.
- **2026-04-16** — Shipped *Wireframe toggle* (was Next #7, pulled forward as a one-day warm-up). Bound to `W` shortcut, surfaced in a promoted View panel that now appears as soon as a model loads (not only after mold generation). The `wireframe` prop was already plumbed through `ModelViewer` — this wired state, keybind, toggle, and cheat-sheet entry. Moved to "What Ships Today"; Next bucket is now items 4–6 (STEP, Oblique, Mold Box).
- **2026-04-16** — Shipped *Opt-in anonymous telemetry* (was Later #11). Five event schema (`session_started`, `model_loaded`, `mold_generated`, `plane_auto_detected`, `file_exported`) with TypeScript-enforced property types so there's no free-form string that could leak paths or names. Off by default, consent prompted after first successful mold generation (not on launch), toggleable in Control Panel → Privacy, versioned so future scope changes re-prompt. Self-hosted Umami target, host hardcoded at build time via `VITE_TELEMETRY_HOST`, CSP `connect-src` locked to that one host so a compromised dep cannot exfiltrate anywhere else; forks built without the env var have the Privacy section invisible and architecturally cannot phone home. Full details in [PRIVACY.md](./PRIVACY.md). Moved to "What Ships Today"; remaining Later items renumbered (i18n is now #11).
- **2026-04-17** — Shipped *Auto-scale-to-printer* (was Later #10). Curated dropdown of 10 printers (7 FDM: Bambu A1/A1 mini/X1C/P1S, Prusa MK4/Mini+/XL, Ender 3; 3 MSLA: Elegoo Saturn 3 Ultra/Mars 5 Pro, Anycubic Photon M5s), grouped by category in the select. Fit readout predicts the *mold* footprint (part size + wall thickness on every face, not just the raw part bbox) so the "✓ fits" indicator doesn't lie to users half the time. Suggested scale is computed with a 95% safety margin and rounded *down* to 1% increments — rounding up would push the mold back into overflow. Never auto-applies; the Apply button makes the user's action visible, reversible (Reset scale link), and never silently mutates the user's 1:1 sculpt. Deliberately distinct from `mold.actionbox.ca` which force-scales to its own fixed volume with no UI. Scale is applied non-destructively: viewport uses a `<group scale>` wrapper, export bakes a `Matrix4.makeScale` into a CLONE of each mold half (original geometry untouched, CSG pipeline still 1:1, changing scale doesn't invalidate the generated mold). Zero new telemetry events — existing 5-event cap respected. 20 pure-fn unit tests cover predict/compute/suggest/format including the "never auto-upscale" and "round down, not up" rules. Moved to "What Ships Today"; remaining Later items renumbered (i18n is now #10).
