<p align="center">
  <img src="assets/logo/logo-256.png" alt="Mold Maker logo" width="128" height="128">
</p>

<h1 align="center">Mold Maker</h1>

<p align="center">
  <em>Source-available, offline-capable, two-part mold generator for 3D printing.</em>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Demo: load sample model, adjust parting plane + cut angle, generate mold halves" width="900">
</p>

Load an STL or OBJ model, pick a parting plane, and export print-ready mold halves with auto-generated sprues, vents, and registration pins. Runs in your browser or as a desktop app. No signup, no cloud upload, no subscription.

## Try It Online

👉 **[matta174.github.io/mold-maker](https://matta174.github.io/mold-maker/)** — no install, runs entirely in your browser (your files never leave your device).

## Downloads

Desktop builds for macOS, Windows, and Linux are on the [Releases page](https://github.com/matta174/mold-maker/releases). Pre-release builds are tagged as such; stable releases drop the `-beta` suffix.

## Quick Start (local dev)

```bash
cd mold-maker
npm install
npm run dev:renderer
```

Then open http://localhost:5173 in your browser.

## Running as Electron Desktop App

```bash
npm start
```

## Features

- **3D Viewer** — Interactive Three.js viewport with orbit controls
- **Manual Parting Plane** — Pick X/Y/Z axis and adjust split position with slider
- **Auto-Detect** — Analyzes model geometry to find optimal parting plane
- **CSG Mold Generation** — Manifold WASM for boolean operations, web-worker-threaded
- **Registration Pins** — Auto-generated alignment pins with clearance-fit holes in the mating half
- **Sprue + Vents** — Auto-placed pour channel and 2–4 air vents at cavity extremities
- **Multi-Format Export** — STL, OBJ, and 3MF output for each half separately
- **Exploded View** — Visualize mold halves separated

## Architecture

- **React + TypeScript** — UI framework (strict mode)
- **Three.js / react-three-fiber** — 3D rendering
- **Manifold (WASM)** — CSG boolean operations for mold generation
- **Vite** — Build tooling
- **Electron** — Desktop app wrapper (optional)

## How It Works

1. Load a 3D model (STL or OBJ)
2. The model is centered and displayed in the 3D viewport
3. Choose a parting plane axis (X, Y, or Z) and adjust the split position
4. Or click "Auto-Detect" to find the optimal split
5. Click "Generate Mold" — this creates a bounding box around your model, subtracts the model to form the cavity, then splits the box into two halves along the parting plane
6. Registration pins, a sprue, and air vents are added automatically
7. Export both halves in your preferred format

## Privacy

Mold Maker collects **no data by default**. If you opt in after your first successful mold generation, the app sends five coarse usage events (session start, model load, mold generation, auto-detect, export) to a self-hosted Umami instance. No mesh data, no file contents, no file paths, no identifiers. Full list and technical details in [PRIVACY.md](./PRIVACY.md). You can toggle it off any time in Control Panel → Privacy.

Forks built without `VITE_TELEMETRY_HOST` architecturally cannot phone home — the Content Security Policy locks outbound requests to that single configured endpoint, and with no endpoint configured the CSP is `'self' blob:`.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for what's being built next and what's explicitly not on the list. The [competitive analysis](./docs/competitive-analysis.md) has the longer reasoning behind each item.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, project layout, and PR workflow. Items tagged 🌱 in the roadmap are designed for people new to the codebase.

Self-hosting your own instance (with your own telemetry endpoint, or none)? See [`deploy/umami/README.md`](./deploy/umami/README.md) for the analytics deploy runbook.

## License

Mold Maker is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE). This means:

- **Free for personal, educational, research, and other noncommercial use.** Hobby projects, schoolwork, non-profit work, and public-benefit use are all covered.
- **Commercial use requires a separate license.** If you're using Mold Maker as part of a business — for example, casting parts you sell, integrating it into a commercial product, or running it internally at a for-profit company — please reach out.

For commercial licensing inquiries, contact **matthewc174@gmail.com**.

This is a *source-available* license, not an OSI-approved open-source license. You have full access to the source code and can modify it for noncommercial use, but commercial rights are retained by the project.
