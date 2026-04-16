# Mold Maker

Open-source, offline-capable, two-part mold generator for 3D printing. Load an STL or OBJ model, pick a parting plane, and export print-ready mold halves with auto-generated sprues, vents, and registration pins. Runs in your browser or as a desktop app. No signup, no cloud upload, no subscription.

## Quick Start

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

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for what's being built next and what's explicitly not on the list. The [competitive analysis](./docs/competitive-analysis.md) has the longer reasoning behind each item.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, project layout, and PR workflow. Items tagged 🌱 in the roadmap are designed for people new to the codebase.
