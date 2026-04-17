# Show HN Draft

**Title:**

```
Show HN: Mold Maker – open-source two-part mold generator for 3D printing
```

(HN has an 80-char title limit and punishes clickbait. Keep this as-is.)

**URL field:** `https://matta174.github.io/mold-maker/`

**Text field (optional on Show HN, but a good one lifts the post):**

```
I got frustrated with the state of 3D-to-mold tooling. The good stuff
(Fusion 360, Netfabb) is either enterprise-priced or locks you into a
subscription. The free stuff (moldmaker.vercel.app, mold.actionbox.ca)
works but makes surprising decisions on your behalf — one of them silently
rescales everything to 69×80×48mm, which is convenient right up until it
destroys your carefully sized sculpt.

Mold Maker is my attempt at the sensible middle: load an STL or OBJ, pick
a parting plane (or auto-detect one), get back two print-ready mold halves
with auto-generated sprues, air vents, and registration pins.

Design constraints I committed to early:
- Offline-first. Your files never leave your device. The app runs as a
  static SPA on GitHub Pages, or as an Electron desktop app. No account,
  no cloud upload.
- Everything that can be a slider, is a slider. Wall thickness, clearance,
  axis, split position — all live, all interactive, all previewable.
- CSG in a worker. Manifold WASM handles booleans off the main thread so
  the UI stays responsive during a 2-second mold generation on a 100k-poly
  input.
- A demoldability heatmap that flags undercuts per-face (green/yellow/red)
  before you run the CSG. Catches most of the "why does this not demold"
  failures at inspection time instead of build time.

What doesn't work yet: non-planar parting surfaces (the big one — the
roadmap has a plan), mesh repair for non-watertight inputs (currently
fails loudly; on the list), STEP export for CNC workflows (OpenCascade
WASM is a ~10MB binary so this needs to be opt-in load).

Stack: React 19, Three.js / react-three-fiber for the viewport, Manifold
3D for the CSG, Vite for build, Electron Forge for the desktop wrap.

Telemetry: off by default, opt-in only after your first successful mold
generation. Five coarse events, no file contents, no paths, no identifiers.
CSP-locked to a single configured endpoint so a compromised dep can't
exfiltrate anywhere else. Full details in PRIVACY.md.

Repo: https://github.com/matta174/mold-maker
Live: https://matta174.github.io/mold-maker/

I'd love feedback from anyone who's actually done mold-making for casting.
The roadmap is currently driven by my intuition plus one competitive
analysis — real user input beats both.
```

---

## Notes on this draft

**Why this framing works on HN:**
- Opens with a specific, verifiable grievance ("silently rescales to 69×80×48mm") — not generic "big companies bad." Concrete beats abstract.
- "My attempt at the sensible middle" — doesn't claim disruption or category creation, which HN reads as honest.
- Lists what *doesn't* work before anyone asks. The comments will surface these anyway; getting ahead of it frames the author as self-aware instead of defensive.
- The stack mention is short but specific enough that readers who care about those libraries engage.
- The telemetry paragraph preempts the "but you're harvesting data" comment that always appears when any web-based tool is posted.

**What to do before posting:**
1. Log in and have the tab open on the actual live GitHub Pages URL — verify it loads, generates a mold, exports. Any bug surfaced in the first hour of HN traffic is a disaster.
2. Make sure the repo has a reasonable recent commit on top (not a placeholder / WIP / debug commit). HN readers click through to the repo.
3. Pin the issue tracker to at least *two* "good first issue" entries so drive-by contributors have something to grab.
4. Be online for the next 4-6 hours after posting. HN's ranking algorithm punishes posts where the author disappears and leaves questions unanswered.

**Timing:**
- Post 8-10 AM Pacific on a Tuesday, Wednesday, or Thursday. Weekend Show HNs get less traffic and less engaged commentary.
- Avoid posting near a major release (Apple event, major GitHub outage, big geopolitical news day) — the front page is crowded then.

**If it doesn't take off (likely outcome, to be honest):**
HN Show posts have a ~10% front-page rate. If this one doesn't hit, don't re-post immediately — the mods dislike that and can shadow-limit the account. Wait a few weeks, ship a meaningful new feature, and try again with a different hook ("Show HN: Mold Maker now with non-planar parting surfaces" etc.). The second attempt often outperforms the first.
