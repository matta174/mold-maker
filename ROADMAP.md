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
- Mold box shape options — three outer-shell shapes: `rect` (default, unchanged), `cylinder` (circular cross-section extruded along the parting axis — wins for round parts where a rectangular shell wastes volume and whose curved walls demold symmetrically), and `roundedRect` (rectangular with rounded vertical edges — small FDM-durability upgrade over sharp corners). Cylinder radius is computed from the bounding-circle *diagonal* of the part's lateral cross-section plus wall thickness, so wall thickness holds at every angle (not just the lateral extrema). Rounded-rect corner radius is capped at `wallThickness × (1 - PIN_INSET_RATIO)` so registration pins still land on straight-edge material. Exposed as a 3-way segmented control at the top of the Mold Box section.
- Oblique parting planes — a 0-30° **Cut Angle** slider tilts the parting plane around its hinge axis (right-handed cyclic convention: X→Y, Y→Z, Z→X). Handles parts that don't split cleanly along X/Y/Z. The CSG path uses Manifold's `splitByPlane(normal, offset)` directly rather than rotated cutter boxes, so the implementation is ~30 lines shorter than the axis-aligned predecessor. Registration pins, sprue, and vent holes are all lifted onto the tilted plane via a signed-distance classifier. Cylinder orientation for pins/sprue/vents stays axis-aligned (within the ±30° cap the deviation from the plane normal is acceptable for v1). `cutAngle=0` takes a bit-identical fast path — existing mold exports regenerate byte-for-byte.
- STEP (.stp) export — each mold half exports as ISO 10303-21 via `opencascade.js` v1.1.1 (a 66 MB WASM build of OpenCascade 7.5.x, 14 MB gzipped over the wire). **Faceted-shell BRep** strategy: each Manifold triangle becomes one `BRepBuilderAPI_MakeFace_15` face, faces sew into a shell via `BRepBuilderAPI_Sewing`, shell writes as STEP in `STEPControl_AsIs` mode. Opens the door for downstream CAM in FreeCAD / Fusion / Onshape rather than forcing users through mesh-to-solid conversion. The OCP WASM is lazy-loaded on first STEP click — users who never click STEP pay zero bytes. Runs in a dedicated Web Worker (not the Manifold worker) so the main thread stays responsive during 20-30s exports and Cancel terminates the worker outright (frees the OCP heap instantly); generating a new mold while STEP runs in background works. Full error-translation catalog (`stepExportErrors.ts`) rewrites technical throws ("sewing produced a null shape") to user-actionable guidance ("The mesh has gaps or overlapping faces. Try STL, or repair in Blender/Meshmixer"). Telemetry's `file_exported` event gained a `'step'` variant so we can watch whether the 66 MB WASM justifies its bundle cost — if adoption is dismal we'll pull it. Two ADRs document the decisions: [`docs/adr/0001-step-export-library.md`](./docs/adr/0001-step-export-library.md) (library + BRep strategy) and [`docs/adr/0002-step-loading-strategy.md`](./docs/adr/0002-step-loading-strategy.md) (lazy-on-click, no prefetch).

What it doesn't do yet is where this roadmap comes in.

## Now (Active Focus)

*Empty as of 2026-04-16.* The three items this bucket opened with — wall thickness + clearance sliders, the demoldability heatmap, and first-run polish — have all shipped. The next focus has not been picked yet.

Candidates are in Next below, but honestly, it'd be more useful to let real users try the current build and tell us what they hit first rather than guess. If a specific item matters to you, **file an issue** — that's the loudest signal we have right now. Opt-in telemetry (now shipped) will start answering some of these questions with data instead of vibes, but only from users who volunteer the signal.

## Next (Soon)

*Empty as of 2026-04-20.* The three items this bucket opened with — mold box shape options, oblique parting planes, and STEP export — have all shipped. The next focus has not been picked yet; telemetry will shape it over the next two weeks (see [ADR-0002](./docs/adr/0002-step-loading-strategy.md) "Follow-on items" for the STEP-specific decisions that depend on real usage data).

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
- **2026-04-17** — Shipped *Oblique parting planes* (was Next #5). 0-30° **Cut Angle** slider tilts the parting plane around its hinge axis (right-handed cyclic: X→Y, Y→Z, Z→X). Chose Manifold's `splitByPlane(normal, originOffset)` over rotating cutter boxes after a dedicated WASM spike — the native path is ~30 lines shorter, avoids a hand-rolled rotated-AABB trick, and produces the same two halves. Plane math lives in a new pure-math [`planeGeometry.ts`](./src/renderer/mold/planeGeometry.ts) (no THREE dependency — uses a structural `BboxLike` shape so the module stays importable from workers, tests, and React components alike). `cutAngle=0` takes a bit-identical fast path: signed-distance classification isn't guaranteed to agree with coordinate comparison on seam-lying points, so existing mold exports regenerate byte-for-byte. Registration pins, sprue, and vent holes are lifted onto the tilted plane via a shared signed-distance classifier; channel cylinder orientation stays axis-aligned (within the ±30° cap the deviation from the plane normal is acceptable for v1). Hardened boundaries: `getPlaneEquation` silently clamps NaN/Infinity/out-of-range inputs via `clampCutAngle`, `primaryAxisValueOnPlane` warns via `dbg()` when the normal's primary component falls below 1e-6 instead of returning a silent 0, and `generateMold` rejects zero-extent bboxes with a clear error. Code hygiene: DRY'd three `planeFromBbox` copies into a single `planeFromBox` helper, consolidated a 15-line switch into `getRotationForAxis`, introduced a `planeIfTilted` null-sentinel helper so the cutAngle=0 fast path is the same shape everywhere, and added a WeakMap-cached `getNonIndexedPositions` in `draftAnalysis.ts` so the heatmap and classification summary share one decoded buffer. Test coverage: +12 tests (135 → 147 passing) covering hinge-axis rotation conventions at 30° on all three axes, the `primaryAxisValueOnPlane` near-zero guard, defensive-clamp behavior at NaN/±Infinity/90°, a full end-to-end integration test of `generateMold` at cutAngle=15° and 20° (empty-halves regression shield for the entire worker-free pipeline), and a wire-level `workerProtocol.test.ts` that catches silent `cutAngle` drops at the postMessage boundary — a class of bug nothing else would have caught. Feature flag `ENABLE_OBLIQUE_PLANES = true`. Moved to "What Ships Today"; Next bucket is now item 4 (STEP export) only.
- **2026-04-20** — Shipped *STEP (.stp) export* (was Next #4). Library chosen: `opencascade.js` v1.1.1 (see [ADR-0001](./docs/adr/0001-step-export-library.md)) — the one maintained JS binding for OCCT, same engine FreeCAD uses, so round-trip fidelity is as good as any web-deployable library can offer. Rejected hand-rolled STEP writing (1,500-page schema, compliance risk ≫ bundle-size gain) and a cloud service (would violate the offline-first positioning). BRep strategy: faceted shell (each Manifold triangle → one `BRepBuilderAPI_MakeFace_15` face; faces sewn via `BRepBuilderAPI_Sewing` into a shell; shell written in `STEPControl_AsIs` mode) rather than solid-BRep surface-fitting (research-grade, out of scope). Real bundle numbers: OCP WASM 65.86 MB raw / 13.98 MB gzipped, STEP worker chunk 298 KB — both code-split as separate Vite assets, so the main bundle delta is only ~50 KB of integration glue. Users who never click STEP pay zero bytes. Lazy-load-on-click is the accepted loading strategy (see [ADR-0002](./docs/adr/0002-step-loading-strategy.md)); prefetch-on-idle rejected at launch as rude for users who never use STEP, with a revisit trigger set at >50% STEP-usage rate in telemetry. Dedicated Web Worker (`stepExportWorker.ts`) keeps the 20-30s export off the main thread and off the Manifold worker — one WASM module per worker is the convention, and it means generating a new mold while STEP runs works cleanly. Worker-level `error` and `unhandledrejection` handlers catch emscripten aborts that escape the onmessage try/catch, posting structured error responses back to the awaiter so a crash doesn't leave the button stuck forever. Full user-facing error catalog (`stepExportErrors.ts`) translates technical throws to actionable guidance — e.g. a null-shape sewing failure becomes "The mold has gaps or overlapping faces. Try STL, or repair in Blender/Meshmixer" instead of exposing OCCT internals. Several `opencascade.js` v1.1.1 quirks pinned with regression tests: filenames > 10 chars corrupt `STEPControl_Writer.Write`, so we write `/t.step` internally and discard after `FS.readFile`; `BRepBuilderAPI_Sewing` requires all 5 ctor args (no defaults); `sewing.Perform` wants `Handle_Message_ProgressIndicator_1()` and rejects JS `null`; the right overloads (`gp_Pnt_3`, `BRepBuilderAPI_MakeEdge_3`, `BRepBuilderAPI_MakeWire_4`, `BRepBuilderAPI_MakeFace_15`, `STEPControl_Writer_1`) took a probe to enumerate. Vite-native worker spawn (`new Worker(new URL('./stepExportWorker.ts', import.meta.url), { type: 'module' })`) plus dynamic `import('opencascade.js/dist/opencascade.wasm.js')` got the chunk-splitting for free. Telemetry's `file_exported` event gained a `'step'` format variant — existing 5-event cap respected, discriminated-union type schema still blocks PII at compile time. Test coverage: 147 → 173 passing (+26 tests) covering the exporter (cube round-trip, empty-mesh rejection, maxTriangles soft-cap, custom tolerance), wire-schema + transferables for `stepExportProtocol`, integration tests that run a full `generateMold` → `exportSTEP` cycle on both axis-aligned and 15° tilted molds (asserts valid ISO-10303-21 HEADER/DATA/ENDSEC + BRep entity + non-empty entity count), and the 9-case error-translation catalog. Moved to "What Ships Today"; Next bucket is now empty.
- **2026-04-17** — Shipped *Mold box shape options* (was Next #6). Three shapes: `rect` (default, unchanged path through the CSG pipeline), `cylinder` (puck extruded along the parting axis), `roundedRect` (rounded vertical edges only — top/bottom stay flat). All shape math lives in a new [`mold/moldBox.ts`](./src/renderer/mold/moldBox.ts) as pure functions (envelope computation + a Manifold factory), unit tested with 19 cases covering AABB math, corner-radius capping, diagonal-radius cylinder sizing, and asymmetric-bbox edge cases. Cylinder radius is `sqrt(halfLatA² + halfLatB²) + wallThickness`, *not* `max(lat)/2 + wall` — the diagonal bound is the only honest choice that keeps wall thickness constant at every angle (at 45° the AABB corner sits at the diagonal distance, which is the tightest point). Rounded-rect corner radius is capped at `wallThickness × (1 - PIN_INSET_RATIO)` (=0.3 × wall with current constants) so registration pins at bbox corners still land on straight-edge material, not inside the rounded cutout — found and fixed a latent bug in an earlier 0.6× cap during review. Pin placement branches in a new `getRegistrationPinPositionsForEnvelope`: cylinder uses 4 cardinal radial pins at `partCircleRadius + (1-PIN_INSET_RATIO)*wall`; rect/roundedRect delegate to the legacy AABB-corner path. Axis-aligned cutters that split the mold in half are unchanged — they already extend past any shell silhouette, so they still correctly slice a cylinder or rounded-rect. `moldBoxShape` threads through `WorkerRequest.payload` (optional, defaults to rect for backwards compat), `moldWorker`, `useMoldGenerator`, `AppState`, and `GeneratedParams` (included in staleness check — changing shape invalidates the current mold). Exposed as a 3-way segmented control at the top of the renamed "Mold Box" section (was "Mold Dimensions"), matching the axis-picker aesthetic and using `role="radiogroup"` + `aria-checked` for keyboard/AT users. Zero new telemetry events. Moved to "What Ships Today"; Next bucket is now items 4–5 (STEP, Oblique).
