# Competitive Analysis — Mold Maker

*Last updated: 2026-04-16. This is a living document; re-run when major competitors ship features or when we ship new ones.*

## TL;DR

Mold Maker is a free, open-source, offline-capable two-part mold generator with auto-generated sprues, vents, and registration pins. Its **engineering bones are strong** (Manifold WASM CSG, worker-threaded generation, multi-format export, scale-relative geometry). Its **UX and feature breadth lag** the two closest web competitors — `mold.actionbox.ca` and `moldmaker.vercel.app` — which have shipped demoldability analysis, non-planar splits, STEP export, and polished onboarding that we haven't.

If I had to pick three bets that would close most of the perceived-feature gap with ~1-2 weeks of work each: **(1) draft-angle/demoldability heatmap**, **(2) exposed wall-thickness & clearance controls**, **(3) a sample model + drag-and-drop onboarding path.** Non-planar contour splitting is the biggest *impressive* gap, but also the most expensive to build well.

The open-source positioning is real and defensible. Nobody else in the two-part-mold space is open-source + offline-capable, and that combination matters to a chunk of users (privacy, air-gapped labs, education, hackability).

## Competitive Set

**Direct competitors — browser-based two-part mold generators** (same problem, same users, same delivery):

- `mold.actionbox.ca` — Free, no signup. Single upload → auto analysis → export. Owns "demoldability heatmap" as a signature visual.
- `moldmaker.vercel.app` ("3D Mold Maker") — Freemium, $12/mo or $99/yr. Signup-gated. Owns "contour split" (non-planar parting) as a signature feature.

**Indirect competitors — DIY mold generation in general-purpose tools**:

- Jason Webb's parametric OpenSCAD script (Thingiverse thing:31581) — Free, code-driven, for people comfortable editing `.scad` files. Battle-tested, forked many times.
- `Ruakij/blender-mold-generator` — Free Blender add-on. Thickest-slice auto-detect, three split planes, non-destructive workflow. No vents/sprues/pins.
- Autodesk Fusion 360 (manual workflow) — Full CAD; mold via Split Body + Shell commands. Free personal tier (3-year renewable, under $1K/yr non-commercial use only); $680/yr commercial. Steep learning curve.
- Blender (manual boolean workflow) — No mold-specific tooling; users assemble it from boolean modifiers and split operators.

**Adjacent / professional-tier**:

- Autodesk Netfabb 2026 — Additive manufacturing prep suite. Enterprise pricing. Not a mold tool per se, but the professional fallback for mesh repair + build prep.
- Shapr3D, Onshape, SolidWorks — Full CAD with draft analysis, parting-line tools. Not mold-specific consumer tools.

**Substitute solutions**:

- Doing nothing — user designs the mold manually in CAD from scratch.
- Outsourcing to a service bureau (Xometry, Protolabs).
- Autodesk Meshmixer — Was free and widely used for mold prep. **Discontinued by Autodesk**. This creates an opportunity: a cohort of users who had a trusted workflow are looking for a replacement.

## Landscape Map

Two axes that actually reveal strategic positioning: **X = accessibility (expert tool → novice-friendly)** and **Y = mold-specific feature depth (generic 3D tool → purpose-built)**.

```
  high │                                        mold.actionbox.ca ●
   Y   │                                            ● moldmaker.vercel.app
depth  │                      ● Fusion 360 (manual mold workflow)
       │                                  ● Mold Maker (ours)
       │      ● OpenSCAD script
       │                       ● Netfabb
       │  ● Blender + addon
   low │  ● Blender (plain)
       └─────────────────────────────────────────────────────────
        expert                                      novice-friendly   X
```

Takeaway: our nearest neighbors in the upper-right quadrant are the two web competitors. We are behind them on the X axis (their onboarding is better) and slightly behind on Y (they have features we don't). The OSS/offline quadrant is ours alone.

## Feature Matrix

Rated: **Strong** (market-leading) / **Adequate** (functional, not differentiated) / **Weak** (exists but limited) / **Absent** (not available). Ratings come from homepage copy, docs, source-code inspection, and my own read of their UX flows — not marketing claims alone.

### Input & Onboarding

| Capability | Mold Maker | moldmaker.vercel.app | mold.actionbox.ca | Fusion 360 | Blender+addon | OpenSCAD script |
|---|---|---|---|---|---|---|
| STL import | Strong | Strong | Strong | Strong | Strong | Adequate |
| OBJ import | Strong | Absent | Strong | Strong | Strong | Absent |
| 3MF / STEP import | Absent | Absent | Absent | Strong | Adequate | Absent |
| Drag-and-drop file load | Weak (click only) | Strong | Strong | N/A (file dialog) | N/A | N/A |
| Sample model for first-run | Absent | Strong | Absent | N/A | N/A | Has default sappo.stl |
| No-signup-required | Strong | Weak (signup gate) | Strong | Weak (Autodesk account) | Strong | Strong |
| Auto-scale to cavity | Absent | Absent | Strong (forced to 69×80×48mm) | Manual | Manual | Manual |

### Parting Plane & Split

| Capability | Mold Maker | moldmaker.vercel.app | mold.actionbox.ca | Fusion 360 | Blender+addon | OpenSCAD script |
|---|---|---|---|---|---|---|
| Manual X/Y/Z plane selection | Strong | Strong | Absent (auto only) | Strong | Strong (YZ/XZ/XY) | Strong |
| Slider to adjust position | Strong | Strong | Absent | Strong (parametric) | Strong | Strong (parametric) |
| Auto-detect optimal plane | Adequate (vertex-balance + Z-pref) | Strong (includes auto-optimize) | Strong (scores multiple planes, undercut-aware) | Absent | Strong (thickest-slice) | Absent |
| Non-planar / contour split | Absent | Strong (signature feature) | Weak (scores planes only) | Adequate (manual surface) | Absent | Absent |
| Cut at arbitrary angle | Absent | Adequate (angle param) | Absent | Strong | Adequate (any plane) | Absent |
| Undercut detection / warning | Absent | Strong (bias param) | Strong (heatmap color-codes it) | Strong (draft analysis) | Absent | Absent |

### Mold Geometry Features

| Capability | Mold Maker | moldmaker.vercel.app | mold.actionbox.ca | Fusion 360 | Blender+addon | OpenSCAD script |
|---|---|---|---|---|---|---|
| Wall thickness | Auto-scaled (not user-adjustable) | Strong (user param, recommendations) | Absent (fixed) | Strong (Shell command) | Absent | Strong (parametric) |
| Clearance / mating slop | Auto-scaled (not user-adjustable) | Absent | Absent | Manual | Absent | Parametric |
| Registration pins / keys | Strong (auto, 4 corner pins, clearance-fit) | Absent | Absent (claims alignment) | Manual | Absent | Strong (parametric pins) |
| Sprue / pour channel | Strong (auto, tapered) | Absent | Strong (auto) | Manual | Absent | Absent |
| Air vents | Strong (auto, 2-4 at extremities) | Absent | Strong (auto) | Manual | Absent | Absent |
| Draft angle analysis | Absent | Absent | Strong (color heatmap) | Strong (Draft Analysis) | Absent | Absent |
| Demoldability scoring | Absent | Adequate (undercut optimizer) | Strong (signature feature) | Strong | Absent | Absent |
| Mold box shape options | Absent (rect only) | Absent | Absent | Manual | Absent | Strong (rect w/ rounded corners, circular) |

### Viewer & UX

| Capability | Mold Maker | moldmaker.vercel.app | mold.actionbox.ca | Fusion 360 | Blender+addon | OpenSCAD script |
|---|---|---|---|---|---|---|
| Real-time 3D viewport | Strong (R3F + orbit) | Strong | Strong | Strong | Strong | Weak (OpenSCAD preview) |
| Multiple view modes | Adequate (exploded, show original) | Strong (Original/Mold/Front/Back) | Adequate | Strong | Strong | Weak |
| Wireframe toggle | Absent | Strong (W key) | Absent | Strong | Strong | Weak |
| Exploded view | Strong | Absent | Absent | Manual | Manual | Absent |
| Keyboard shortcuts documented | Absent | Adequate | Absent | Strong | Strong | Weak |
| Progress indicator during generation | Adequate ("Generating Mold…") | Adequate | Adequate | N/A | N/A | N/A |
| Accessibility (ARIA, keyboard nav) | Adequate (recent pass) | Unknown | Unknown | Strong | N/A | N/A |

### Output & Export

| Capability | Mold Maker | moldmaker.vercel.app | mold.actionbox.ca | Fusion 360 | Blender+addon | OpenSCAD script |
|---|---|---|---|---|---|---|
| STL export | Strong | Strong | Strong | Strong | Strong (manual) | Strong |
| OBJ export | Strong | Absent | Strong | Strong | Strong | Absent |
| 3MF export | Strong (geometry) | Absent | Strong (with material/color) | Strong | Adequate | Absent |
| STEP (.stp) export | Absent | Absent | **Strong** (OpenCascade) | Strong | Absent | Absent |
| Per-half export | Strong | Strong | Strong | Manual | Manual | Manual |
| Slicer-ready settings | Absent | Absent | Adequate (3MF print settings) | Absent | Absent | Absent |

### Business Model & Distribution

| Capability | Mold Maker | moldmaker.vercel.app | mold.actionbox.ca | Fusion 360 | Blender+addon | OpenSCAD script |
|---|---|---|---|---|---|---|
| Price | **Free** | $12/mo or $99/yr | **Free** | Free personal (restricted) / $680/yr commercial | **Free** | **Free** |
| Open source | **Yes** | No | No | No | Yes | Yes |
| Offline capable | **Yes (Electron)** | No | No | Yes | Yes | Yes |
| Source code hackable | **Yes** | No | No | No | Yes | Yes |
| No-signup | **Yes** | No | Yes | No | Yes | Yes |

## Gap Analysis (Roadmap-Driven)

Ranked by impact-per-effort for the current positioning. "Effort" is a rough dev-week estimate; "impact" is how much a first-time user would notice.

### Tier 1 — Build These Next

**1. Demoldability / draft-angle heatmap overlay**
- *Why it matters:* This is actionbox.ca's signature feature and the single most credible-looking thing a free competitor has. Users understand "red means bad" instantly. It also partially compensates for not having contour splitting, because the user can *see* why a straight cut won't work and manually reposition.
- *Effort:* ~1 week. You already have vertex normals available. The math is: for each triangle, compute the angle between its normal and the pull direction; bucket into 4 colors; render as per-face vertex colors on the preview mesh.
- *Complexity trap:* The "correct" definition of demoldability depends on whether you treat it as a ray test (does any geometry block the pull path?) or a normal test (is the face undercut relative to the pull axis?). Start with the normal test — it's fast, visually credible, and matches what actionbox does.
- *Dependencies:* None. Runs on the existing geometry, no new WASM.

**2. Expose wall thickness & clearance as user controls**
- *Why it matters:* Right now `WALL_THICKNESS_RATIO = 0.08` and `CLEARANCE_RATIO = 0.05` are hardcoded constants. For a small figurine they're fine; for a 200mm-tall print they produce 16mm walls that wastes filament, and for a 20mm part they produce 1.6mm walls that crack on demold. Moldmaker.vercel.app's recommendation copy ("5-8mm for larger models") exists because users *ask* about this.
- *Effort:* 2-3 days. Add two sliders to ControlPanel, flow them through `generateMold`'s args, update `paramsChanged` to compare them too. Add an "Auto" mode that uses the current ratios.
- *Non-obvious design call:* Default to absolute millimeters, not ratios. Users think in mm. Expose ratios as an advanced toggle.
- *Dependencies:* None.

**3. Sample model + drag-and-drop onboarding**
- *Why it matters:* Empty-state friction is the #1 reason tools like this lose users in 10 seconds. Currently you land on a blank viewport with a button. Moldmaker.vercel.app offers a sample; actionbox.ca auto-scales whatever you upload. Both remove the "I don't have an STL handy" objection.
- *Effort:* 1-2 days. Drop 1-2 small STLs (a cat figurine, a simple geometric shape) into `public/samples/`, add a "Try sample" button on the empty-state panel. Drag-and-drop is ~30 lines — add `onDrop` on the viewport div and reuse the existing file-loader path.
- *Gotcha:* Don't bundle a large STL into the Electron build. Keep samples under ~200KB each.

**4. Documented keyboard shortcuts**
- *Why it matters:* Cheap signal of "this is a serious tool." Users notice when W toggles wireframe and ? brings up a help sheet. Moldmaker.vercel.app calls out W explicitly in its UI copy.
- *Effort:* 2-3 days. Bind keys in App.tsx (wireframe, explode, reset view, 1/2/3 for axis), add a `?` overlay with the cheat sheet.
- *Dependencies:* None, but pairs well with adding a wireframe toggle to the viewport (currently absent).

### Tier 2 — Build These Next Quarter

**5. STEP (.stp) export**
- *Why it matters:* If anyone ever wants to take your mold into a real CAD tool (Fusion, SolidWorks, FreeCAD) for manual editing, or machine it on a CNC instead of printing it, STEP is the only format that preserves it as solid geometry rather than a mesh. Actionbox does this via OpenCascade; it's a pro-tier signal.
- *Effort:* 1-2 weeks. `occt-import-js` or `opencascade.js` gives you STEP export from a manifold mesh. Integration is non-trivial — the WASM binary is large (~10MB) and you need to decide if it's opt-in or always-loaded.
- *Honest counterpoint:* Ask whether your users actually want this before you ship it. If 90% of them are going straight to a slicer with an STL, STEP export is a wow-factor feature nobody uses. Add instrumentation before investing.

**6. Cut angle (oblique parting plane)**
- *Why it matters:* Some geometries have zero good axis-aligned parting planes but one obvious oblique one. Moldmaker.vercel.app exposes cut angle as a parameter.
- *Effort:* 3-5 days for the geometry; 1-2 days for the UI. The CSG code already uses a cutting-box approach; rotate the cutters by the angle instead of keeping them axis-aligned.
- *Trap:* Once you add angle, the registration-pin placement logic has to follow. Currently `getRegistrationPinPositions` hardcodes axis-aligned corners.

**7. Mold box shape options (rounded-rect, cylinder)**
- *Why it matters:* Circular parts (bottles, bowls, dials) get less material and cleaner demolding from a cylindrical mold box. OpenSCAD-era users expect this because Jason Webb's script has it. It's a cheap parity item.
- *Effort:* 2-4 days. Manifold has cylinder primitives; the sprue/vent placement logic already handles cylindrical rotation.

### Tier 3 — Maybe, Much Later

**8. Non-planar / contour split**
- *Why it matters:* The *most* impressive gap on paper. Moldmaker.vercel.app's "Contour Split" is their signature feature and the only reason someone would pay $99/yr over using actionbox.
- *Effort:* **3-5 weeks** if you want it done well. Requires sampling the model at N perpendicular slices, fitting a smoothed 2D parting curve per-slice, lofting those curves into a parting *surface*, and using that surface as the CSG cutter. Manifold can do the final boolean once you have the surface, but constructing the surface is most of the work.
- *Honest call:* I wouldn't build this yet. It's high-effort, hard to test, easy to produce bad results for weird geometry, and actionbox's demoldability heatmap delivers 70% of the practical value for 20% of the effort. **Build the heatmap first.** Revisit contour splitting only if users ask for it specifically.

**9. Mesh repair / auto-healing**
- *Why it matters:* The `generateMold` function throws when the input mesh isn't watertight, and the user has no way to recover. Netfabb is a $thousand-a-year tool largely because mesh repair is genuinely hard.
- *Effort:* 1-2 weeks to get "good enough" — Manifold has some tolerance for small gaps via `MERGE_TOLERANCE`; you could expose that. True hole-filling and self-intersection fixing is much harder.
- *Honest call:* Better to write a clear error message + link to Meshmixer successors (like `PrusaSlicer`'s built-in repair or `MeshLab`) than half-implement this.

**10. Auto-scale-to-print-volume**
- *Why it matters:* Actionbox does this (forced 69×80×48mm) and it's a genuinely nice touch for users who don't know their printer's build plate. But it's also a footgun — auto-scaling a figurine without telling the user is how you ruin their weekend.
- *Effort:* 2-3 days. UI is the hard part: a dropdown of common printers (Bambu X1C, Prusa MK4, Ender 3, custom).
- *Honest call:* Do this as a soft suggestion ("Your model is 210mm tall — most desktop printers max out at 250mm. Scale to 95%?") rather than a forced auto-scale.

## What Mold Maker Already Does Better — Don't Lose These

It's worth calling out what's already defensible so you don't refactor it away or underweight it in positioning:

**Open source + offline-capable.** This is the single largest differentiator. Both web competitors are closed-source SaaS. The Electron desktop build plus MIT-style licensing means Mold Maker works in air-gapped labs, classrooms without internet, and for users who don't want their STLs going to a third-party server. No competitor can credibly match this without abandoning their business model.

**Auto-generated registration pins.** Moldmaker.vercel.app doesn't do this. Actionbox doesn't either. Your CSG pipeline generates clearance-fit pins at four corners with proper holes in the mating half. This is genuinely better mold engineering than either paid or free competitor offers.

**Auto-generated sprue + vents with scale-relative sizing.** Actionbox has basic auto-channels; moldmaker.vercel.app does not mention them at all. Your vent placement uses a candidate-sampling approach with minimum spacing — that's more sophisticated than a fixed-position approach. The scale-relative sizing (`EST_WALL_THICKNESS_RATIO`, `SPRUE_GATE_TO_WALL`) means it works for a 10mm pendant and a 200mm vase without tuning.

**Web-worker-threaded generation.** Neither competitor appears to offload CSG to a worker (based on UX patterns — both appear to block during generation). Your worker pipeline means the UI stays responsive for long operations on complex meshes.

**Multi-format input (STL + OBJ).** Moldmaker.vercel.app is STL-only. Actionbox handles both.

**3MF export.** Future-proof. STL is lossy (no units, no metadata); 3MF is what the print community is moving to.

## Positioning Recommendation

Don't position Mold Maker as "cheaper than moldmaker.vercel.app" or "easier than Fusion 360" — both claims are weak and defensive. Position it as:

> **The open, local, no-signup mold generator.** Load an STL, get a print-ready two-part mold with sprues, vents, and alignment pins, all on your own machine. No cloud upload, no subscription, no vendor lock-in. Open source, hack it to your needs.

That sentence targets three audiences simultaneously: privacy-conscious hobbyists, classroom/lab users who need offline tools, and the open-source-preferring maker crowd who already donate via tips rather than subscriptions.

The wedge against moldmaker.vercel.app is "no subscription + you own the code." The wedge against actionbox.ca is "offline + open + OBJ support + registration pins + exploded preview." Neither of them can match both axes without rebuilding their product.

## Trend Response (Strategic Posture)

**Trend: AI-assisted 3D tooling.** Meshy AI and similar tools are being cross-linked by moldmaker.vercel.app. Mid-term, users will expect to go text → 3D model → mold in a single flow. *Posture: Monitor.* Not worth building yet (the input side is moving fast and the output side — your mold gen — is the durable part). Set a trigger: revisit if 2+ major mold tools integrate text-to-3D.

**Trend: 3MF as the default format.** Bambu, Prusa, and Orca slicers have all moved 3MF to the default. *Posture: Fast-follow.* You already export 3MF. Consider upgrading to 3MF with embedded print settings (like actionbox does) since it's a small step from where you are.

**Trend: Autodesk shutting down free tools.** Meshmixer is gone. Fusion 360's free tier has been progressively narrowed. *Posture: Lead.* This is exactly the moment to be the OSS successor. Don't be subtle about it in your README — "If you loved Meshmixer for mold prep, here's a focused alternative that won't get yanked."

**Trend: STEP becoming a checkbox for prosumer 3D tools.** Once a few of your competitors have it, the absence becomes a rejection criterion. *Posture: Monitor, build in Q2/Q3.* Set a trigger: if a second free competitor ships STEP, escalate to Tier 1.

## Recommended Top 3 (If You Only Do Three Things)

If you want the sharpest possible shortlist:

1. **Demoldability heatmap.** One week of work, addresses the single largest credibility gap with actionbox, unlocks the "why is this mold failing?" conversation with users.
2. **Expose wall thickness + clearance.** Few days of work, addresses the most common unasked question, turns a hidden engineering choice into a user-tunable dial.
3. **Sample model + drag-and-drop + documented shortcuts.** A few days of polish that collectively take the first-run experience from "huh, what now?" to "oh, this is a real tool."

Do those three before touching contour splitting. The payoff-per-hour is not close.

## Change Log

- 2026-04-16 — Initial version. Covered the 3 user-provided URLs plus Fusion 360, Blender+addon, Netfabb, Meshmixer, OpenSCAD script, Printables single-sided variant. Identified top-10 gaps and top-3 priorities.
