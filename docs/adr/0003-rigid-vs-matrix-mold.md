# ADR-0003: Dual output modes — rigid shell and matrix mold

**Status:** Accepted (scoping; no implementation yet)
**Date:** 2026-04-23
**Deciders:** @matthewc174

## Context

Mold Maker v0.1.0-beta.1 shipped as a **rigid two-part shell generator**. The user loads a 3D model, picks a parting plane, and gets two printable halves that form a cavity. They cast their material (resin, wax, plaster, soft silicone) directly into the cavity.

This was pitched as a "two-part silicone mold generator" — a mistake. On launch day a caster on [r/ResinCasting](https://reddit.com/r/ResinCasting/comments/TBD) pointed out that:

1. A **silicone mold** is a mold *made of silicone* — flexible, forgiving of undercuts, reusable for many casts. You cannot 3D-print silicone on a consumer printer, so "generates a silicone mold from an STL" is a nonsense claim.
2. What people casting for any serious purpose actually want is a **matrix mold** (also: mother mold, shell mold): a rigid outer shell with mating flanges that holds a flexible silicone inner. The user prints the shell, pours silicone into the gap between the model and the shell interior, lets it cure, then uses the silicone inner to cast many copies.
3. The rigid-shell-as-direct-cavity product we built is useful, but it's a smaller audience — hobbyists casting a single rigid copy (resin miniature, lost-wax pattern, plaster prop). Matrix molds serve the much larger audience of "I want to duplicate my sculpt ten times in soft silicone."

We need to decide what shape the product takes going forward given this feedback.

## Decision

**Offer both as a top-level output-mode toggle in the same app.** Add a `moldMode` state field with two values:

- `"rigid-shell"` — current behavior. Two halves that form a direct cavity for the user's casting material.
- `"matrix-shell"` — new. Two halves that form a *gap* around an offset of the model, into which the user pours silicone. The output shell has flanges for bolting and an opening for the silicone pour.

The two modes share: model loading, parting-plane UI, registration pins, mold box shape (rect/cylinder/rounded), export pipeline, printer-fit calculator.

The two modes diverge at: channel placement (matrix mold has no sprue/vents — the silicone pour fills via the flange opening), clearance semantics (rigid = gap between mold and cast; matrix = silicone wall thickness), cavity validation (different physics), UI copy.

## Options Considered

### Option A: Replace rigid-shell entirely with matrix mold

**Rejected.** Matrix mold serves a larger audience on average, but rigid-shell has legitimate use cases the commenter's feedback didn't invalidate: lost-wax casting for jewelry, plaster molds for ceramic slip casting, direct resin casts where a silicone inner would be overkill. Burning an existing working feature to chase a feedback thread would be impulsive and would frustrate v0.1 users who are already using the rigid-shell path.

### Option B: Spin matrix mold off as a separate project

**Rejected.** The two modes share ~70% of the pipeline (loading, parting plane, mold box shape, registration, CSG, export). A separate project would duplicate that shared infrastructure and fragment a small user base across two apps. Worse: users who want both (print a rigid shell for one project, a matrix for another) would need two tools instead of one.

### Option C: Dual modes via top-level toggle (CHOSEN)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium-high. Mode toggle is trivial UI; the matrix-mold CSG path is substantively new code (surface offset, shell construction, flange generation). |
| Cost | 10-20 engineering-days, likely split across two sprints. No new dependencies. |
| Scalability | Shares all the shared code; divergent code paths are isolated to a `matrix/` subfolder. Tests can mostly reuse rigid-shell fixtures with mode-aware assertions. |
| Team familiarity | Rigid-shell internals are well-understood. Surface offset is new territory — we need a spike before committing. Manifold-3D does have a `minkowski`/`offset` primitive that should work, but neither has been driven in anger here. |

**Pros:**
- Serves both audiences without forcing a choice.
- Natural progression: users who learn Mold Maker for rigid-shell gain matrix mold as an upgrade path, rather than having to switch tools.
- Shared infrastructure keeps the maintenance burden tractable.
- The mode toggle itself is a clear communication device — reading the UI, a user understands immediately that Mold Maker does both things and what the difference is.

**Cons:**
- Doubles the test surface for the divergent paths.
- UI complexity grows: some controls only make sense in one mode (sprue override is rigid-only; silicone wall thickness is matrix-only). Conditional rendering needs to be explicit rather than hidden.
- Documentation load doubles — separate tutorials, example models, failure-mode catalogs per mode.

### Option D: Skip matrix mold entirely

**Rejected.** The feedback is unambiguous that matrix mold serves a larger audience than rigid-shell. Not implementing it means the project's ceiling is the rigid-shell audience — a real but niche group. The cost of option C is real but it's a one-time investment that opens a much bigger user base. Not building it would be choosing "don't serve the larger audience" for cost reasons, which is the wrong trade for a pre-product-market-fit project.

## Consequences

### Architecture

- New top-level state field: `moldMode: 'rigid-shell' | 'matrix-shell'`. Threads through `WorkerRequest.payload`, `GeneratedParams` (staleness detection), and `AppState`.
- New folder: `src/renderer/mold/matrix/` for matrix-specific CSG, channel placement, cavity validation.
- Existing `src/renderer/mold/generateMold.ts` becomes rigid-shell-specific; factor out shared primitives (bounding box math, mold box envelope, registration pins, export) into `src/renderer/mold/shared/`.
- New module: `src/renderer/mold/matrix/offsetSurface.ts` — offset the input mesh by N mm outward. Manifold's `Offset()` function is the current best candidate; spike required to validate behavior on non-smooth meshes.
- Flange generation: the matrix mold's two halves need a perimeter flange with bolt-hole pairs. This is a geometric primitive unlike anything rigid-shell does; it'll be its own module.

### UI

- New segmented control at the top of the control panel: "Output" → "Rigid shell" | "Matrix shell". Placed above the current Parting Plane section so the mode decision is made first.
- Conditional controls:
  - Rigid mode only: Clearance, Sprue override, Sprue position, Vent count preview.
  - Matrix mode only: Silicone wall thickness (the offset distance), Flange width, Bolt count.
  - Shared: Parting plane axis + position + cut angle, Mold box shape, Registration pins, Wall thickness, Printer fit.
- Demo/tutorial updates: the README demo GIF shows rigid-shell workflow. Matrix mode needs its own short demo.

### Telemetry

- `mold_generated` event gains a `mode: 'rigid-shell' | 'matrix-shell'` property. Existing 5-event schema cap respected (no new event type, just an added property on existing event). Discriminated-union typing prevents PII from leaking through.

### Testing

- Move the `generateMold` integration tests into a `rigid-shell/` subfolder. Add a mirrored `matrix-shell/` folder once the matrix pipeline lands.
- Add a per-mode protocol test (`workerProtocol.test.ts`): verify `moldMode` survives the structured-clone boundary.
- Regression-shield: rigid-shell output must be byte-for-byte identical before and after this change. A `matrix-shell`-mode flag with no callers should not alter any current code path.

### Documentation

- Update README to describe the two modes side-by-side in the Features section.
- Add a docs/modes.md explaining the difference with casting-physics context (what goes where, why one or the other).
- Update the competitive-analysis doc — matrix-mold is a feature area where our competitors vary, and we should articulate where we land on that axis.

### Not in scope for this ADR

- The specific UI copy and control ordering within matrix mode. That's a design pass after the technical spike.
- Whether matrix mode supports the full set of mold box shapes (rect/cylinder/rounded). Probably yes, but deferred until the offset-surface spike validates.
- Multi-part matrix molds (3+ shell pieces for severely undercut parts). Not planned for v0.2; mirrors the "no multi-part rigid molds" stance already in ROADMAP.md.

## Implementation plan

This ADR accepts the direction; execution is staged:

1. **Spike (1-2 days):** validate Manifold's `Offset()` on three test meshes (smooth rounded, faceted angular, mesh with narrow features). Measure: does it preserve topology? What happens at sharp internal corners? Document findings in `src/renderer/mold/spike_offsetSurface.test.ts`.
2. **Refactor rigid-shell path (2-3 days):** extract shared primitives into `shared/`. No behavior change; regression tests pass byte-identical.
3. **Matrix pipeline (5-10 days):** offsetSurface → build shell around offset → generate flanges with bolt holes → CSG-split along parting plane. Gated by the spike outcome.
4. **UI integration (2-3 days):** mode toggle, conditional controls, updated export flow.
5. **Tests + docs (2-3 days):** matrix-mode integration tests, docs/modes.md, README update, demo GIF update.

Total estimate: 12-21 engineering days. Likely one solo sprint, or two sprints if the offset-surface spike uncovers surprises.

## Open questions

- Does Manifold's `Offset()` handle the meshes we'll typically see? If not, we may need to use a different library (meshlab-wasm?) or implement our own offset via signed-distance-field voxelization. Spike answers this.
- How should clearance work in matrix mode? The "clearance" concept from rigid-shell doesn't map cleanly — what's analogous is the offset distance itself (= silicone wall thickness). Worth a separate small design note.
- Do we need a third mode later (e.g. "draped flexible inner, no rigid outer" — just print the silicone gap as a thin-walled mesh for pouring)? Not now, but architecting the mode toggle to accept a third value at negligible cost makes sense.

## References

- Feedback thread that motivated this ADR: [r/ResinCasting launch post](https://reddit.com/r/ResinCasting/comments/TBD). Comment is the definitive statement of what users expect when they hear "silicone mold generator."
- ROADMAP item #15 (Matrix mold generator, Later bucket): short-form version of this ADR; this doc is the long-form rationale.
- Manifold-3D docs on `Offset()`: https://manifoldcad.org/jsdocs/classes/Manifold.html#offset
- Reference material on matrix mold construction: Smooth-On's [Brush-On Mold Tutorial](https://www.smooth-on.com/tutorials/brush-on-silicone-mold-with-jacket-shell/) and [Matrix Mold Guide](https://www.smooth-on.com/tutorials/matrix-mold-technique/) show the physical process we're generating shells for.
