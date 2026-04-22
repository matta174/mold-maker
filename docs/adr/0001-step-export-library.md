# ADR-0001: STEP export via opencascade.js, faceted-shell BRep

**Status:** Accepted
**Date:** 2026-04-17
**Deciders:** @matthewc174

## Context

The mold-maker app generates watertight 3D meshes (via Manifold-3D) representing mold cavities and cores. The competitive analysis (docs/competitive-analysis.md, gap #4) flagged the absence of **STEP export** as one of the top three feature gaps vs. mold-design CAD tools (MoldFlow, Inventor tooling, SolidWorks mold cavity). Hobbyists import STEP into FreeCAD, Fusion 360, Onshape, or Bambu Studio to do downstream CAM work; our current STL-only output forces them through mesh-to-solid conversions that every downstream tool does poorly.

We need a STEP writer that runs in the **browser / Electron renderer** (no server-side Python) and produces output that passes OpenCascade-based importers (FreeCAD uses OCCT; Fusion and Onshape use proprietary importers but both handle OCCT-generated STEP).

Input we have to work with: watertight triangle meshes from Manifold (`vertProperties`, `triVerts`). No parametric surface information — everything is triangulated.

Two coupled questions:
1. **Which STEP-writing library?**
2. **Which BRep representation — proper solid (parametric surfaces) or faceted (triangle shell)?**

Both were de-risked in spikes: `src/renderer/mold/spike_stepExport.test.ts` (OCP primitive → STEP) and `src/renderer/mold/spike_meshToStep.test.ts` (Manifold mesh → faceted BRep → STEP).

## Decision

1. **Library:** `opencascade.js` v1.1.1 — a 66 MB WASM build of OpenCascade 7.5.x.
2. **BRep strategy:** **Faceted shell**. Each Manifold triangle becomes one `BRepBuilderAPI_MakeFace_15(wire, onlyPlane=true)` face; faces are sewn via `BRepBuilderAPI_Sewing` into a shell; the shell is written as STEP via `STEPControl_Writer` in `STEPControl_AsIs` mode. Wrap in `BRepBuilderAPI_MakeSolid` when the sewing result is watertight; fall back to shell-only output otherwise.

## Options Considered

### Option A: opencascade.js (CHOSEN)

The only maintained JavaScript binding for OpenCascade. Wraps the same C++ library FreeCAD uses, so round-trip fidelity is as good as any web-deployable library can offer.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — emscripten binding quirks documented below; not a one-liner. |
| Cost | 66 MB WASM, added at bundle or load time. Free/open-source (LGPL-2.1 + OCCT exception). |
| Scalability | Per-triangle face build scales at ~2-3 ms/tri in the spike; 50k-tri meshes will take ~2 min and produce ~50 MB STEP files. Worker thread + progress UI mandatory. |
| Team familiarity | Low — no prior OCCT exposure. Balanced by spike coverage. |

**Pros:**
- Produces ISO-10303-21 output that FreeCAD/Fusion/Onshape all consume.
- Shares an engine with FreeCAD → round-trip fidelity is the best achievable.
- Ships as a drop-in npm package (v1.1.1 on npm; v2+ would require a custom emscripten build toolchain — much higher complexity).
- Also unblocks future features: BRepAlgoAPI_Fuse (proper boolean solids), topology queries, IGES export.

**Cons:**
- 66 MB WASM is a real bundle-size hit. Must be lazy-loaded behind the "Export STEP" button — see task #27 for loading strategy.
- v1.1.1 has several emscripten binding oddities that take work to discover:
  - `STEPControl_Writer.Write(filename)` corrupts filenames longer than 10 characters (pinned in `spike_stepFilename.test.ts`). Workaround: use a short internal FS path and throw it away.
  - Overload suffixes (`_1`, `_2`, ...) aren't documented and don't follow any visible ordering. Finding `BRepBuilderAPI_MakeFace_15` as the wire-based constructor required enumerating all 22.
  - `BRepBuilderAPI_Sewing` requires all 5 constructor args (no defaults).
  - `sewing.Perform(...)` requires a `Handle_Message_ProgressIndicator_1()` — JS `null` is rejected.
  - Vite can't resolve the package's `import wasm from "./*.wasm"` pattern; we bypass `index.js` and feed raw WASM bytes to the factory via `wasmBinary`.
- Type definitions ship but are auto-generated and don't cover most method overloads. `any` everywhere in the wrapper.
- 32 npm audit vulnerabilities at install time (mostly transitive, mostly low/medium; none in the runtime WASM). Accept as tech debt.

### Option B: Hand-rolled STEP writer

Generate ISO-10303-21 entities directly from mesh data without an OCCT layer. Output entity types: `CARTESIAN_POINT`, `VERTEX_POINT`, `ORIENTED_EDGE`, `EDGE_LOOP`, `ADVANCED_FACE`, `CLOSED_SHELL`, `MANIFOLD_SOLID_BREP`.

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — STEP is a formal schema (AP214/AP242); writing a conformant emitter takes weeks and catches every edge case one at a time. |
| Cost | Zero bundle weight. Our own code. |
| Scalability | Excellent — pure string building. |
| Team familiarity | Low — no STEP-schema expertise. |

**Pros:**
- No external dependency. No 66 MB WASM.
- Total control over entity graph.

**Cons:**
- STEP is ~1,500 pages of schema. Getting even basic AP214 conformance is a project, not a sprint. Real-world importers reject non-conformant files silently or emit cryptic errors.
- We'd be reinventing a wheel that OCCT has spent 20 years smoothing.
- First bug in production would almost certainly be "FreeCAD says 'bad reference' on a user's file." No clear path to diagnose without a reference implementation.

**Rejected:** compliance risk + time cost ≫ the bundle-size gain.

### Option C: Server-side conversion (cloud STEP service)

Send mesh bytes to a backend that runs trimesh/FreeCAD/pythonocc and returns STEP.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — ops burden, auth, rate limits. |
| Cost | Ongoing hosting + egress cost. |
| Scalability | Depends on backend capacity. |
| Team familiarity | Medium. |

**Pros:**
- No client-side bundle impact.
- Can use the full Python OCCT ecosystem (pythonocc-core) which has better docs than opencascade.js.

**Cons:**
- App is currently a zero-backend browser/Electron app. Adding a server changes the deployment story, the privacy story (user mold geometry leaves their machine), and introduces outages.
- Contradicts the "runs locally, your mesh never leaves your computer" positioning in the launch messaging (docs/launch/show-hn.md, reddit.md).

**Rejected:** violates the offline-first architecture that competitive positioning depends on.

### Option D: Solid BRep (vs. faceted)

Reconstruct parametric surfaces from the mesh — detect planar regions, cylindrical features, fit splines — then build a proper B-Rep solid with `PLANE`, `CYLINDRICAL_SURFACE`, etc.

| Dimension | Assessment |
|-----------|------------|
| Complexity | Research-grade — mesh-to-BRep surface fitting is an active CAD research area. |
| Cost | Weeks-to-months of work; unknown success rate. |
| Scalability | Unclear. |
| Team familiarity | None. |

**Pros:**
- Smaller STEP file. Easier to edit downstream — a cylinder is a cylinder, not 200 triangles.
- Preserves design intent more faithfully.

**Cons:**
- Out of scope. OCCT doesn't do this automatically. Autodesk's ReverseEngineering workbench and commercial tools like Geomagic/Mesh2Surface exist precisely because it's hard.
- Our input is already a mesh — whatever design intent existed upstream is already lost by the time Manifold produces output.

**Rejected:** infeasible in this project's scope.

## Trade-off Analysis

The library choice is low-risk in retrospect — the spike shot down every kill-gate concern in a few hours, and the alternatives (hand-rolled, cloud) fail on either compliance cost or architectural fit.

The harder trade-off is faceted vs. solid BRep:

| Consideration | Faceted (chosen) | Solid |
|---------------|-----------------|-------|
| Works from mesh input | Yes | No — requires surface fitting |
| Implementation effort | 1-2 days | Weeks (research-grade) |
| Downstream editability | Limited — each tri is a face | Excellent — cylinders/planes addressable |
| File size | O(triangles) — large | O(features) — small |
| Importer compatibility | All tested tools | All tested tools |

**Faceted wins on "works at all."** The 50 MB STEP file issue (for 50k-triangle meshes) is real but bounded: typical mold outputs are 5-20k triangles → 5-20 MB files, which every importer handles. We can mitigate with a "decimate before export" toggle later if user feedback demands it.

## Consequences

**Becomes easier:**
- Shipping STEP export — the only "real CAD format" on the competitive-analysis gap list (doc#4).
- Future features that need OCCT (IGES export, proper solid booleans, topology analysis).

**Becomes harder:**
- Bundle management. 66 MB WASM cannot live in the main bundle — it needs lazy loading (task #27). Electron's fs-based WASM load is trivial; the web-dev-server story is less trivial because Vite's WASM resolution is broken for this package.
- Dependency tree. opencascade.js pulls in a lot of transitive dev-dep vulnerabilities (32 `npm audit` findings). Most are low-severity and none affect the WASM itself; must be monitored but not a blocker.

**Revisit if:**
- opencascade.js v2.x ships as a prebuilt npm package (currently it's a custom-build toolchain only).
- A native STEP importer ships in Chrome's File System Access API (won't happen in the foreseeable future).
- Users consistently ask for editable solid output — at that point consider shelling out to a server-side surface-fitter.

## Pinned API gotchas (v1.1.1)

These are the non-obvious things the implementation in `exporters.ts` must do; pinned here so a future opencascade.js upgrade catches regressions via the corresponding test.

- **Load WASM by feeding bytes, not by import.** `import('opencascade.js')` triggers Vite to try parsing the `.wasm` as an ES module and fails. Instead:
  ```ts
  const mod = await import('opencascade.js/dist/opencascade.wasm.js');
  const oc = await mod.default({ wasmBinary: await fetch(wasmUrl).then(r => r.arrayBuffer()) });
  ```
  In Electron main-process fallback, read via `fs.readFileSync`.
- **Filenames ≤ 10 chars** for `STEPControl_Writer.Write`. Use `/t.step` internally and throw away after `FS.readFile`. Pinned in `spike_stepFilename.test.ts`.
- **Required ctor args** (all of these lack defaults in v1.1.1):
  - `BRepBuilderAPI_Sewing(tolerance, sameParam, cutting, samePoint, nonManifold)` — all 5.
  - `sewing.Perform(handle)` — pass `new Handle_Message_ProgressIndicator_1()`; JS `null` rejected.
- **Overload discovery.** The right constructors for the faceted path:
  - `gp_Pnt_3(x, y, z)`
  - `BRepBuilderAPI_MakeEdge_3(pnt, pnt)`
  - `BRepBuilderAPI_MakeWire_4(edge, edge, edge)`
  - `BRepBuilderAPI_MakeFace_15(wire, onlyPlane=true)`
  - `STEPControl_Writer_1()` + `.Transfer(shape, STEPControl_AsIs, true)` + `.Write('/t.step')`.

## Action Items

1. [x] Spike: OCP primitive → STEP — `spike_stepExport.test.ts`
2. [x] Spike: Manifold mesh → faceted BRep → STEP — `spike_meshToStep.test.ts`
3. [x] Pin the filename-length bug — `spike_stepFilename.test.ts`
4. [ ] Implement `exportSTEP()` in `src/renderer/mold/exporters.ts` (task #25)
5. [ ] Wire into UI + dispatch + telemetry (task #26)
6. [ ] Measure bundle impact + decide loading strategy (task #27)
7. [ ] Full-pipeline integration test: `generateMold(...)` → STEP validity (task #28)
8. [ ] User-facing error handling + large-mesh warning (task #29)
9. [ ] Manual FreeCAD/Fusion round-trip on a real mold — parking-lot item before shipping
