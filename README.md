# Mold Maker

Open-source two-part mold generator for 3D printing. Load an STL/OBJ model, choose a parting plane, and export mold halves in STL, OBJ, or 3MF format.

## Quick Start

```bash
cd mold-maker
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

## Running as Electron Desktop App

```bash
npm run electron:dev
```

## Features

- **3D Viewer** — Interactive Three.js viewport with orbit controls
- **Manual Parting Plane** — Pick X/Y/Z axis and adjust split position with slider
- **Auto-Detect** — Analyzes model geometry to find optimal parting plane
- **CSG Mold Generation** — Uses Manifold WASM for boolean operations
- **Registration Pins** — Auto-generated alignment pins on mold halves
- **Multi-Format Export** — STL, OBJ, and 3MF output
- **Exploded View** — Visualize mold halves separated

## Architecture

- **React + TypeScript** — UI framework
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
6. Registration pins are added at the corners for alignment
7. Export both halves in your preferred format
