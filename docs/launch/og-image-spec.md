# OG Preview Image — Design Spec

The image that unfurls when someone pastes the link into HN comments, Reddit, Slack, Discord, Twitter/X, Bluesky, or iMessage. This is often the *only* thing a tab-hopping reader sees before deciding whether to click.

**File to produce:** `public/og-image.png`
**Dimensions:** 1200×630 (exact — both HN and Twitter crop based on this ratio)
**Format:** PNG, 8-bit, <300KB. Not JPEG — text rasterizes cleaner in PNG.
**Once committed:** uncomment the `og:image` and `twitter:image` meta tags in `index.html` (they're already there, commented, waiting for the file).

---

## The constraint most people miss

At thumbnail size (~500px wide on mobile), your image is the size of a business card. Anything smaller than ~40px tall in the source will be illegible. So:

- **One headline, one visual, maybe one secondary line.** Not a hero + three feature bullets + tagline + logo + URL. That's a web banner, not an OG image.
- **Real contrast.** #666 on #1a1a2e looks fine in Figma at 100% zoom and invisible on a phone. Body text should pass WCAG AA (4.5:1) against its background, same rules as the app itself.
- **No screenshot in the background with UI text on top.** The rendered viewport is busy enough that overlaid text fights it. Either the screenshot *is* the image, or the text gets its own quiet panel.

---

## Brand palette (use these, not approximations)

Pulled from the actual running app so the OG card feels continuous with the product.

| Token | Hex | Use |
|---|---|---|
| Background | `#1a1a2e` | Main canvas (matches `body` in index.html) |
| Text primary | `#e0e0e0` | Headline, body (matches app default) |
| Text secondary | `#9a9aba` | Subtitle / supporting line |
| Heatmap green | `#4ade80` | Accent — "this is safe / demoldable" — our brand color by accident |
| Heatmap yellow | `#facc15` | Secondary accent, use sparingly |
| Heatmap red | `#ef4444` | Tertiary accent — only if explicitly evoking the failure state |
| Panel | `#252545` | Slight lift for a text panel over a screenshot |

**Don't invent new colors.** If the OG image uses a teal the app doesn't, the card feels like marketing rather than the product, and that triggers the "pitch voice" allergy that HN and Reddit both have.

---

## Three layouts, ranked by recommendation

### Layout A — "Product-first" (recommended)

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌────────────────────────────┐  ┌───────────────────────┐    │
│  │                            │  │ Mold Maker            │    │
│  │                            │  │                       │    │
│  │   [rendered viewport,      │  │ Two-part molds from   │    │
│  │    generated mold with     │  │ any 3D model.         │    │
│  │    heatmap cued up,        │  │ In your browser.      │    │
│  │    dark background]        │  │                       │    │
│  │                            │  │ github.com/matta174   │    │
│  └────────────────────────────┘  └───────────────────────┘    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

- Left: 700×630 region holds a clean screenshot of the viewport — sample model loaded, mold generated, heatmap overlay visible (green dominant, some yellow). No control panel, no file drop zone, no header chrome. Screenshot the viewport *canvas only*, then place it on the dark background.
- Right: 500×630 text panel. Product name at 72pt, one-line value prop at 32pt, repo URL at 22pt.
- Why this wins: the heatmap is the most visually distinct thing about the app. A thumbnail-size viewer who sees colored 3D geometry thinks "this is a real tool." One that sees only text thinks "another landing page."

### Layout B — "Pure product shot"

Fill the whole 1200×630 with the viewport screenshot. Overlay a small logo/wordmark in the bottom-left corner (80px tall panel, rounded, `#252545` background, `#e0e0e0` text: "Mold Maker").

- Cleanest, most "this is what the app looks like."
- Risk: at Twitter/X thumbnail size, no text is readable and people don't know what they're looking at.
- Use this *only* if you have a dramatic screenshot — e.g., a complex sculpt with a full rainbow heatmap.

### Layout C — "Typography-first"

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│                     Mold Maker                                 │
│              ─────────────────────────                         │
│         Two-part mold generator for 3D printing.               │
│              Free. Offline. Open-source.                       │
│                                                                │
│   [small row of 3 tiny product thumbnails or iconset below]    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

- Reads at any size. Most accessible option.
- Risk: indistinguishable from every other dev-tool landing page. People scroll past.
- Only use if you can't get a clean product screenshot.

**Pick A unless a specific reason rules it out.**

---

## Copy — three variants, pick one

The text fills the right panel in Layout A (or the center strip in C). Pick based on what you think the reader needs in 0.8 seconds:

**Variant 1 — utility framing:**
> Mold Maker
> Two-part molds from any 3D model. In your browser. Free, open-source, offline.

**Variant 2 — pain-point framing:**
> Mold Maker
> Stop hand-modeling mold halves. Generate sprues, vents, and pins from an STL in seconds.

**Variant 3 — identity framing:**
> Mold Maker
> The open, offline mold generator for 3D printing and resin casting.

Recommended: **Variant 1** for HN (utility > pitch), **Variant 2** for r/3Dprinting and r/ResinCasting (pain point resonates), **Variant 3** if you ever have a landing page headline to match.

You'll almost certainly want to generate *one* image and use it everywhere rather than rotating variants — one image is plenty, and the link previews get cached on the platform side so rotating doesn't work the way you'd hope.

---

## Typography

Use a font that's already licensed for commercial use and that renders identically on macOS, Windows, and Linux when Canva/Figma exports to PNG.

| Role | Font | Size | Weight | Color |
|---|---|---|---|---|
| Headline ("Mold Maker") | **Inter** or **Geist** | 72pt | 700 (bold) | `#e0e0e0` |
| Subhead (value prop) | **Inter** | 32pt | 500 (medium) | `#e0e0e0` |
| Meta (repo URL) | **JetBrains Mono** | 22pt | 500 | `#9a9aba` |

Avoid: Helvetica (blurry anti-aliasing on Windows Chrome), Roboto (too generic for a maker-tool vibe), Comic Sans (you laugh but someone always suggests it).

---

## Canva recipe

1. Create a new design → Custom size → 1200×630px.
2. Set canvas background: Elements → Shape → Square → fill `#1a1a2e`, stretch to fill.
3. **Layout A left panel:** drop the screenshot PNG. Crop to fit the 700×630 zone. Apply an 8px inset shadow in `#0c0c1a` to separate it from the background.
4. **Right panel:** Text → Add heading → "Mold Maker" 72pt Inter Bold. Text → subheading below, 32pt Inter Medium, max width 420px (forces line break).
5. Export → PNG → "Compress file" off (you want quality). Download.
6. Run through [Squoosh](https://squoosh.app/) (mozJPEG off, OxiPNG level 4) to shrink from ~800KB to ~180KB without visible quality loss.
7. Save to `public/og-image.png`.

## Figma recipe

1. New file → Frame (F) → 1200×630, name it `og-image`.
2. Fill `#1a1a2e`. Add auto-layout inside the frame (Shift+A) if you're using Layout A — horizontal direction, 24px gap, 40px padding.
3. Place screenshot (700×630 frame) as first auto-layout child. Place text frame (460×auto) as second child.
4. Text: Inter Bold 72 / Inter Medium 32 / JetBrains Mono 22.
5. Export the frame → PNG → 1x. Run through Squoosh (same as above).
6. Save to `public/og-image.png`.

## Ai-assisted recipe (if skipping design tools)

Prompt a diffusion model with something like:
> "A clean product marketing banner, 1200x630, dark navy background hex #1a1a2e, on the left a clean 3D rendered geometry with green undercut highlights overlay, on the right large bold text reading 'Mold Maker' with a smaller subtitle 'Two-part molds from any 3D model. In your browser.', Inter font, minimal, professional, no gradient, no glow, flat contemporary design."

Risk: almost every model will add fake UI chrome, spurious buttons, gradient glows, or 6-finger mechanical parts. Plan to edit the result in Figma/Canva anyway. Generating from scratch in design tooling is faster.

---

## Validation checklist

Once `public/og-image.png` is committed and the meta tags are uncommented:

- [ ] Paste `https://matta174.github.io/mold-maker/` into https://www.opengraph.xyz/ — should preview the image, title, description with no warnings about missing or oversized assets.
- [ ] Paste the URL into https://cards-dev.twitter.com/validator (if the Twitter/X validator is still up; fall back to posting to a throwaway draft to preview).
- [ ] Open the URL preview in Slack DM to yourself — Slack caches aggressively, so use a fresh Slack workspace or append `?v=2` to bust the cache.
- [ ] On a phone, preview the link in iMessage. This is the most punishing thumbnail size and will surface any illegible-text problems.
- [ ] Check the PNG is **under 300KB**. The OG image is fetched inline by every unfurl; large files slow the preview and some scrapers (Facebook) give up after a timeout.

If the preview looks broken after pushing: wait 24 hours *before* re-generating. Most platforms cache the unfurl result for a day and re-scrape only on cache miss. Appending `?v=2` to the URL forces a re-scrape on most platforms.

---

## Do-not-do list (earned from other launches)

- **Don't put a QR code on the OG image.** Nobody scans an OG image. It's just visual noise.
- **Don't embed the word "LAUNCHED" or "NEW" or a rocket emoji.** Reads as pitch voice; HN downvotes.
- **Don't use a stock "3D printer" photo from Unsplash.** The scraper will pattern-match it against a million other posts and the post will feel generic. Use *your own screenshot* even if it's less polished.
- **Don't show a Fusion 360 or Blender UI in the background.** Even as a joke. Someone will assume it's a Fusion plugin and write an annoyed comment.
- **Don't localize the image into multiple languages.** The launch is English-only; revisit this after i18n ships (roadmap item #11).
