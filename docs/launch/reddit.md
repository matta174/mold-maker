# Reddit Launch Drafts

Reddit's self-promo rules are strict and subreddit-specific. Read each sub's rules (sidebar → "Rules" or "Wiki") before posting. Many subs require a 90/10 ratio (comment 9x more than you self-promote) and will ban-on-sight new accounts that post projects. If your Reddit account is <30 days old or has <100 comment karma, spend a week participating in these subs first or the post gets instant-removed.

---

## r/3Dprinting (target: 4M+ members, tight moderation)

**Mod rules to check:** Tuesday is typically "self-promo allowed" day — confirm in current rules. Flair: "Discussion" or the sub's specific "I made this" tag.

**Title:**

```
I built a free two-part mold generator for 3D printing — feedback welcome
```

**Body:**

```
I got tired of the good mold-prep tools being either behind paywalls or
doing weird things like silently rescaling your model to fit whatever
default build plate the author uses. Spent the last few months building
an alternative:

→ Load an STL or OBJ
→ Pick a parting plane or auto-detect one (now with a 0-45° cut-angle
  slider for parts that don't split cleanly along X/Y/Z)
→ Get two print-ready mold halves with sprues, vents, and registration
  pins
→ Export as STL, OBJ, 3MF, or STEP (for CNC workflows)

What it generates: a rigid two-part shell you 3D print. Pour your casting
material (resin, wax, plaster, or silicone) directly into the cavity.
It's NOT a silicone mold generator — you can't print silicone from a
normal 3D printer. (A matrix-mold mode where the shell wraps around
a silicone inner is on the roadmap — feedback from r/ResinCasting
pointed me in that direction.)

Runs entirely in your browser (your files never upload anywhere) or as
a Windows/macOS/Linux desktop app. Free for hobby and personal use under
a source-available license (PolyForm Noncommercial); commercial use
requires a license from me — email in the repo.

Heatmap view highlights undercuts per-face before generation, so you
can spot demolding problems without running the CSG first. That's the
feature I reach for most on my own prints.

Try it: https://matta174.github.io/mold-maker/
Desktop downloads: https://github.com/matta174/mold-maker/releases
Code: https://github.com/matta174/mold-maker

What I'd really appreciate: if you try it on one of your own models and
it fails or does something unexpected, tell me. Real-world STLs finding
edge cases my procedural test models miss is the single most useful
thing anyone can give me right now.

Happy to answer questions about the tech stack (React + Three.js +
Manifold WASM + OpenCascade WASM for STEP) or the design decisions in
the comments.
```

**Why this framing:** leads with a relatable grievance, describes what it does in 4 bullet points (r/3Dprinting is skim-heavy), gets ahead of the terminology criticism by explicitly saying "not a silicone mold generator" (a v0.1 mistake I'm not repeating), ends with an ask for help rather than a pitch. The "try it on your own models" ask gives people a reason to engage beyond upvote/ignore.

---

## r/ResinCasting (target: ~50k members, smaller but this is literally the audience)

**Note — v0.1 post already happened on 2026-04-23.** A professional caster gave four specific points of feedback that reshaped the roadmap ([see ROADMAP.md revision history for 2026-04-23](../../ROADMAP.md#revision-history)). If posting this sub again, LEAD with what changed as a result of that thread — r/ResinCasting respects "I listened and shipped" more than "here's a tool" on a second pass.

**Body (for a hypothetical second post, post-fixes):**

```
Update from my v0.1 post earlier — a caster in this sub pointed out
that (1) calling the tool a "silicone mold generator" was wrong, (2)
percent-based clearance doesn't match how anyone actually thinks about
this, (3) putting N vents at bbox extremities is the wrong algorithm
(vents go at cavity ceiling local maxima), and (4) the real useful
feature is a matrix/mother mold generator that wraps a silicone
inner, not the rigid-shell-only thing I'd built.

Shipping updates so far:
- Terminology fixed everywhere (README, landing page, social preview)
- Absolute-mm units now on the roadmap as the next patch (issue #N)
- Topology-based vent placement on the roadmap as a v0.2 feature
- Matrix-mold generator added as a future alternative output mode

If you've got time to poke it again, I'd want to know:
- Once the mm-based clearance slider ships, what's your default for
  pin-hole fit in FDM?
- For the matrix-mold mode scoping: do you want the shell to be a
  "bolt-together box with a mouth," a "clamshell with flanges," or
  something else entirely?

Live: https://matta174.github.io/mold-maker/
Code: https://github.com/matta174/mold-maker (issues are open)
```

**Why this framing:** "I listened" posts do much better than "I built" posts in small craft subs. Names the commenter's four points explicitly so they (and similar readers) see their feedback got turned into real roadmap changes.

---

## v0.1 original post — superseded, kept for reference

Original draft body — posted 2026-04-23 on r/ResinCasting. Terminology ("open-source," "silicone mold generator") was wrong; feedback on it reshaped the roadmap. Don't re-post verbatim.

```
Casters of r/ResinCasting — I've been building a free source-available
tool for generating two-part molds from 3D models, and I'd love input
from people who actually cast for a living or hobby.

The workflow is: load a 3D model (STL/OBJ) → pick a parting plane → get
two rigid mold halves with auto-generated sprue, vents, and registration
pins → print the halves and cast as normal.

A few things I've been unsure about that I'd like input on:
- Default clearance between pin and hole. I settled on a percentage of
  model scale (1-15% slider, default 5%), but I don't know if that's
  what experienced casters expect.
- Vent placement — currently puts up to 4 at geometric extremities. Is
  this usually enough? Do you manually add more?
- The tool doesn't yet support non-planar parting surfaces. How often
  are you running into models where no flat parting plane works cleanly?

Link: https://matta174.github.io/mold-maker/
Source: https://github.com/matta174/mold-maker

Trying to get the defaults right before adding features. If you try it
and it gives you something useless, I want to know why.
```

---

## r/functionalprint (target: ~500k members, smaller secondary)

Only post here if (a) you have a compelling *photo* of a successful mold print in action, and (b) the r/3Dprinting post has already landed well (so you've got vetted content). A text-only post here will bounce.

**Skip this one initially.** Revisit after you have real user results to share.

---

## r/MechanicalKeyboards, r/miniatures, r/boardgames

These are adjacent niches (custom caps, miniatures, game tokens all involve casting). **Do not blast them at launch** — the reddit admins pattern-match cross-posting across subs as spam. Pick the single best fit based on traction from r/3Dprinting and cross-post there later with subreddit-specific framing.

---

## General notes

**Account sanity:**
- Use a real Reddit account with history, not a new burner. Mods and anti-spam tooling filter new accounts aggressively.
- If matta174 is a fresh account, spend a week commenting genuinely on r/3Dprinting before posting. Every comment + upvote you get lowers the chance your launch post gets auto-removed.

**When to post:**
- Tuesday-Thursday, 9-11 AM Eastern is the sweet spot for these subs (most engaged audience, least competition from weekend memes).
- Not Monday (too early in the week, people still catching up) or Friday (engagement dies over weekend).

**Post-launch behavior:**
- Answer every top-level comment for the first 3 hours. Reddit's algorithm weighs author engagement heavily.
- Don't argue with criticism. If someone says "this is dumb because X," say "fair, X is a known limitation — how would you approach it?" Turns a critic into a contributor.
- If a comment asks for a feature, check whether it's already on ROADMAP.md. If yes, link the specific line. If no, add it to the roadmap *after the launch dies down* so the list reflects real demand, not launch-day noise.

**If the post gets removed:**
Message the mods politely asking why. Don't re-post. Don't complain publicly — that gets you banned from the sub. Read the feedback, fix the framing, try a different sub first.
