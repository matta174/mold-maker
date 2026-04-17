# Reddit Launch Drafts

Reddit's self-promo rules are strict and subreddit-specific. Read each sub's rules (sidebar → "Rules" or "Wiki") before posting. Many subs require a 90/10 ratio (comment 9x more than you self-promote) and will ban-on-sight new accounts that post projects. If your Reddit account is <30 days old or has <100 comment karma, spend a week participating in these subs first or the post gets instant-removed.

---

## r/3Dprinting (target: 4M+ members, tight moderation)

**Mod rules to check:** Tuesday is typically "self-promo allowed" day — confirm in current rules. Flair: "Discussion" or the sub's specific "I made this" tag.

**Title:**

```
I built a free, open-source two-part mold generator that runs in your browser — feedback welcome
```

**Body:**

```
Been frustrated for a while that the good mold-prep tools are either
behind paywalls or do weird things like silently rescaling your model.
Spent the last few months building an alternative:

→ Load an STL or OBJ
→ Pick a parting plane or auto-detect one
→ Get two print-ready mold halves with sprues, vents, and registration pins
→ Export as STL, OBJ, or 3MF

Runs entirely in your browser (your files never upload anywhere) or as
a desktop app. Free, open-source (MIT), no account needed.

Heatmap view highlights undercuts per-face before generation, so you can
spot demolding problems without running the CSG first. That's the feature
I'm most curious whether people actually find useful — it's the one I keep
reaching for on my own prints.

Try it: https://matta174.github.io/mold-maker/
Code: https://github.com/matta174/mold-maker

What I'd really appreciate: if you try it on one of your own models and
it fails or does something unexpected, tell me. I need real-world STLs
hitting it to find the edge cases my procedural test models miss.

Happy to answer questions about the tech stack (React + Three.js +
Manifold WASM) or the design decisions in the comments.
```

**Why this framing:** leads with a relatable grievance, describes what it does in 4 bullet points (r/3Dprinting is skim-heavy), ends with an ask for help rather than a pitch. The specific ask ("try it on your own models") gives people a reason to engage beyond upvote/ignore.

---

## r/ResinCasting (target: ~50k members, smaller but this is literally the audience)

**Body:**

```
Casters of r/ResinCasting — I've been building a free open-source tool
for generating two-part molds from 3D models, and I'd love input from
people who actually cast for a living or hobby.

The workflow is: load a 3D model (STL/OBJ) → pick a parting plane → get
two mold halves with auto-generated sprue, vents, and registration pins
→ print the halves and cast as normal.

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

**Why this framing:** asks specific questions where the audience knows more than the author. r/ResinCasting respects genuine craft questions and dislikes "check out my app" drops.

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
