# Pre-Launch Checklist

The goal: when you hit "submit" on the Show HN or Reddit post, you have ~30 seconds before someone clicks the link. Anything broken at that moment is a disaster. This checklist exists to make that not happen.

## T-2 weeks: infra

- [ ] **GitHub Pages Source = "GitHub Actions".** Repo → Settings → Pages → Source → **GitHub Actions**. With the default "Deploy from a branch", GitHub's built-in "pages build and deployment" workflow silently ships your raw repo root — the live URL returns 200, but the browser console shows MIME errors on `/src/renderer/main.tsx` (content-type text/html) and the CSP header still contains literal `%TELEMETRY_CONNECT_SRC%` because no Vite build ever ran. It looks deployed. It is not. Our custom `deploy-pages.yml` also fails at `actions/configure-pages@v5` until this toggle is flipped — chicken-and-egg, one-time manual step.
- [ ] **Lockfile in sync with `package.json`.** After any version bump in `package.json`, run `npm install` locally *and commit both files together*. Local `npm install` is forgiving — it reconciles drift invisibly. CI runs `npm ci`, which fails fast with `EUSAGE` when the lockfile disagrees (classic trap: a Vite major bump transitively changes `esbuild` and 20+ platform binaries that the lockfile still pins to the old version). Verify locally: `rm -rf node_modules && npm ci` → exit 0.
- [ ] **First successful Pages deploy.** Push a trivial commit (or trigger the `deploy-pages.yml` workflow manually) and confirm the site loads at `https://matta174.github.io/mold-maker/`. Hard-refresh (Ctrl+F5) or use an incognito window — GH Pages' CDN can serve stale HTML for several minutes after a redeploy. Open DevTools, confirm zero console errors, then generate a mold end-to-end. Export an STL. Open the STL in a slicer to confirm it's valid. If any of this fails, fix before posting.
- [ ] **Manifold WASM worker test.** Open the live site in a fresh browser profile (no cache) on a slow connection. Load the sample model, generate a mold. If there's a 404 on the WASM asset due to the `/mold-maker/` base path, you'll see it here. Fix: either switch to absolute WASM loading or add an explicit `new URL(..., import.meta.url)` wrapper around the manifold import.
- [ ] **Umami deployed + secrets set.** `deploy/umami/README.md` runbook → get an Umami website ID → add `VITE_TELEMETRY_HOST` and `VITE_TELEMETRY_WEBSITE_ID` as repo Secrets. Trigger one more Pages build. Generate a mold, opt in on the consent modal, check the Umami dashboard for the event. (If you skip this, launch still works, you just lose the usage data from the launch traffic — which is the single best dataset you'll ever get.)

## T-1 week: content

- [ ] **OG preview image.** Make a 1200×630 PNG showing the viewport with a generated mold (green heatmap cued up looks good). Save to `public/og-image.png` in the repo. Uncomment the `og:image` and `twitter:image` meta tags in `index.html`. Test the unfurl with https://www.opengraph.xyz/ — it should show the image plus the title and description. **Full design spec (layouts, palette, copy variants, Canva/Figma recipe):** [`og-image-spec.md`](og-image-spec.md).
- [ ] **Demo GIF.** Record a 15-25 second screencap of: load sample model → show heatmap → generate mold → export. Keep it short; people tab away after 30 seconds. Save as `docs/demo.gif` and add it to the top of README.md above the "Try It Online" link. Acceptable sizes: under 5MB (GitHub's display limit is 10MB but smaller loads faster from mobile). Use [`record-demo.sh`](record-demo.sh) to convert the raw recording — it handles the two-pass palette for clean heatmap colors, and can emit mp4 instead of gif via `--mp4` (GitHub now renders inline video and mp4 is ~4x smaller than the equivalent gif).
- [ ] **Two "good first issue" labels.** Create two or three small, well-scoped issues tagged `good first issue` (e.g., "add a tooltip to the Wall Thickness slider", "i18n scaffolding for the Control Panel labels"). Drive-by contributors clicking through from HN need something to grab; an empty issue tracker reads as "this project is dead."
- [ ] **CONTRIBUTING.md once-over.** Read it as if you'd never seen the repo. Anything that assumes context a newcomer doesn't have? Tighten those bits.
- [ ] **Pick a primary CTA.** The launch posts link to both the live demo and the repo. HN readers prefer clicking code links; Reddit prefers clicking demo links. That's fine — but make sure the live demo is the *first* link in each post (recovery if the repo link intimidates a non-developer).

## T-24 hours: final sweep

- [ ] **Test on Firefox, Safari, Chrome.** The heatmap overlay and viewport controls hit enough Three.js edge cases that one browser will surprise you. Do a full generate-export cycle on each.
- [ ] **Test on mobile.** Don't claim mobile support in the post (the orbit controls + file drop are genuinely awkward on touch), but confirm the site at least loads and renders something recognizable. A completely broken mobile experience will get roasted.
- [ ] **Check `https://matta174.github.io/mold-maker/robots.txt`** exists and doesn't disallow crawling. GH Pages's default is fine — just verify it wasn't accidentally overridden.
- [ ] **Read the actual post drafts out loud.** Any sentence that sounds corporate, rewrite. HN and Reddit both pattern-match against "pitch voice" and downvote it.
- [ ] **Re-read your ROADMAP.md "Not Planned" section.** Someone in the comments will ask for one of those features. Having a one-line canned response ready ("Not planned — mold flow simulation is what Fusion + Netfabb do with teams of engineers, not the problem we're solving") keeps your comment replies clean.

## Launch day

- [ ] **Post time.** Tuesday-Thursday, 8-10 AM Pacific for HN; 9-11 AM Eastern for Reddit. Don't post on the same day as a major tech announcement (Apple event, WWDC, RustConf, etc.) — those crowd out everything else on HN.
- [ ] **Sequence.** HN first, then the r/3Dprinting post ~2 hours later, then r/ResinCasting ~4 hours after that. Spacing avoids the cross-sub "this looks like spam" pattern and lets you learn from the first round's feedback before the next.
- [ ] **Be available for 6 hours.** Nothing kills momentum like a post that asks questions and doesn't answer comments for 4 hours. Block calendar time.
- [ ] **Don't engage with obvious trolls.** One-sentence dismissive replies ("this already exists in Fusion 360"), take the L, move on. Long replies to bad-faith comments drag the thread down.
- [ ] **Screenshot the best comments.** Positive and negative. They're product research.

## Day-after

- [ ] **Do NOT immediately add every requested feature to the roadmap.** Let the feedback settle for a few days. A feature demanded loudly by 3 people in a launch thread may or may not reflect actual user priorities. Cross-reference against telemetry once it starts flowing — real usage data is a much stronger signal than launch-day comments.
- [ ] **Fix any bug reported by multiple people in the first 24 hours.** Single bug reports might be environment-specific; two independent reports almost always mean a real bug.
- [ ] **Close the loop on CONTRIBUTING.md gaps.** If commenters asked "how do I run this locally" even though it's in the README, that's a signal the README isn't working. Rewrite.

## If the launch flops

If HN doesn't upvote and Reddit doesn't engage: that's data. It means either the framing didn't land (fixable) or the product's value isn't self-evident (harder — means more work on the product itself, or on a sharper articulation of who it's for).

Don't panic-iterate. Let the dust settle a week, read the analytics (if Umami is live), talk to whoever did engage, and ship one meaningful improvement before trying again. The second attempt often outperforms the first because the product is better *and* you know what framing didn't work.
