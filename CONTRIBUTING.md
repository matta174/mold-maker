# Contributing to Mold Maker

Thanks for taking the time. Mold Maker is maintained in spare time; contributions of any size — typo fixes through new features — are genuinely appreciated.

If you're looking for *what* to work on, the [ROADMAP](./ROADMAP.md) has items labeled by difficulty (🌱 🌿 🌳). If you want to understand *why* a given item matters, the [competitive analysis](./docs/competitive-analysis.md) has the reasoning.

## Prerequisites

- **Node.js 20 or newer.** Vite 8 and Electron 41 both require modern Node. If you use `nvm`, run `nvm use 20` before installing.
- **npm** (ships with Node). Yarn and pnpm should also work but are not tested in CI.
- No special system dependencies — Manifold is WASM, Three.js is pure JS. macOS, Linux, and Windows all supported.

## Setup

```bash
git clone https://github.com/matta174/mold-maker.git
cd mold-maker/mold-maker
npm install
```

If `npm install` fails with a message about `@rollup/rollup-<platform>-<arch>-gnu` being missing, that's a known npm bug with optional native dependencies. Fix it with:

```bash
npm install @rollup/rollup-linux-x64-gnu --no-save   # adjust platform/arch as needed
```

## Running Locally

**In the browser** (fastest iteration, no Electron overhead):

```bash
npm run dev:renderer
```

Then open http://localhost:5173.

**As the Electron desktop app** (needed when testing anything that touches the main process, native dialogs, or CSP):

```bash
npm start
```

## Tests and Typecheck

```bash
npm test              # run vitest once
npm run test:watch    # re-run on file save
npm run test:coverage # generate coverage report
```

CI runs the test suite on every PR. If your change touches pure functions in `src/renderer/mold/` or `src/renderer/utils/`, please add or update tests — they're quick to write with `vitest` + `happy-dom`.

Type errors fail CI. The project is on TypeScript strict mode.

## Project Layout

A quick tour for your first PR:

```
src/
├── main/                  # Electron main process (window, preload)
│   ├── electron.ts
│   └── preload.ts
└── renderer/              # React app — 95% of the code
    ├── App.tsx            # Top-level state, viewport, Canvas
    ├── theme.ts           # Design tokens — always import from here
    ├── components/
    │   ├── ControlPanel.tsx  # Right-hand sidebar
    │   ├── ModelViewer.tsx   # Three.js model rendering
    │   └── PartingPlane.tsx  # Parting-plane indicator mesh
    ├── hooks/
    │   └── useMoldGenerator.ts  # Worker bridge for CSG
    ├── mold/              # Pure geometry / CSG — no React
    │   ├── constants.ts        # Tunable ratios (wall thickness, clearance, etc.)
    │   ├── generateMold.ts     # The CSG pipeline
    │   ├── channelPlacement.ts # Pin, sprue, vent positions
    │   ├── moldWorker.ts       # Web Worker wrapper
    │   ├── workerProtocol.ts   # Main↔worker message types
    │   ├── manifoldBridge.ts   # Three.js ↔ Manifold conversion
    │   └── exporters.ts        # STL / OBJ / 3MF serialization
    └── utils/
        ├── fileLoader.ts  # STL / OBJ parsing
        └── minizip.ts     # Tiny zip writer for 3MF
```

Most features land in one of: a new control on `ControlPanel.tsx`, a new tunable in `mold/constants.ts`, or a new operation in `mold/generateMold.ts`.

## Finding Something to Work On

1. Look through the [ROADMAP](./ROADMAP.md). Items marked 🌱 are designed for people new to the codebase.
2. Check the [GitHub Issues](https://github.com/matta174/mold-maker/issues) for anything labeled `good first issue` or `help wanted`.
3. If you have your own idea, open an issue describing the *problem you're solving* (not just the feature you want). This catches overlap and design concerns before you invest code time.

## Pull Request Workflow

1. **Fork, branch.** Name branches by what they do, not who did them: `feat/demoldability-heatmap`, `fix/axis-button-aria`, `docs/contributing-setup`.
2. **Keep PRs small.** A focused 100-line PR is reviewed in a day. A 2000-line feature PR stays in review purgatory. If a feature is big, split it: geometry math first, then UI, then polish.
3. **Run tests and typecheck before pushing.** CI will tell you, but it's faster to catch locally.
4. **Write a PR description** that answers: what changed, why, what you tested. A screenshot or GIF for any UI-visible change saves a review round-trip.
5. **Respond to review comments.** If you disagree with a comment, say so — we'd rather have a conversation than a silent push-back. If you agree, push a fix and resolve the thread.

## Code Style

The project leans on machine-enforced style rather than a long style guide:

- **TypeScript strict mode is on.** No `any` unless you explain why in a comment. Prefer `unknown` + a narrowing check.
- **Design tokens live in [`src/renderer/theme.ts`](./src/renderer/theme.ts).** Never hardcode hex colors or pixel sizes in components — add a token if one's missing.
- **Tunable geometry ratios live in [`src/renderer/mold/constants.ts`](./src/renderer/mold/constants.ts)** with a JSDoc comment explaining what the ratio is relative to. Don't scatter magic numbers through `generateMold.ts`.
- **Pure functions in `mold/` and `utils/` get tests.** Anything with React, Three.js, or WASM in it is harder to test and exempt.
- **Accessibility:** real `<button>` elements with `aria-*` attributes, not `<div onClick>`. Run the project, tab through the UI, confirm your addition is reachable.

## Commit Messages

Keep the subject line under ~70 characters and focused on the *what* and *why*, not the *how*. The current project style uses topic-prefixed summaries ("Phase B + UI polish: worker, Electron hardening, theme, a11y, Regenerate flow"). Conventional Commits (`feat:`, `fix:`, `docs:`) is fine too — pick one and be consistent within the PR.

If your commit is non-obvious, use the body to explain why. `git blame` will thank you.

## Reporting Bugs

Open an issue with:

- What you did (load this STL, click Generate, etc.)
- What you expected
- What actually happened
- Your platform (browser + OS, or Electron version)
- The STL file if you can share it, or a minimal repro

Console logs and stack traces are gold.

## Security

If you find something that looks like a security issue — an XSS in the file loader, a sandbox escape in Electron, an RCE via CSG input, any kind of user-data leak — please email the maintainer directly rather than opening a public issue. A public contact address will be added to [SECURITY.md](./SECURITY.md) once that file exists.

## Questions

- Technical questions → GitHub Issues with the `question` label
- Broader design discussion → GitHub Discussions (if enabled) or a thread on an existing issue

Thanks for contributing.
