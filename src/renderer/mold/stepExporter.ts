// ─────────────────────────────────────────────────────────────────────────────
// STEP (ISO 10303-21) export via opencascade.js v1.1.1
// ─────────────────────────────────────────────────────────────────────────────
//
// This module lives apart from exporters.ts because it is the ONE exporter
// that pulls in WASM (66 MB of OpenCascade) at runtime. Keeping it separate
// preserves exporters.ts's "no Manifold/WASM dependency" invariant — that file
// is safe to import anywhere. This one is lazy-loaded behind the "Export STEP"
// action so the WASM only enters memory when a user actually asks for STEP.
//
// Strategy: faceted-shell BRep. Each mesh triangle becomes a single-face BRep
// (MakeFace_15 with onlyPlane=true since triangles are trivially coplanar),
// all faces are sewn into a shell, the shell is written as STEP. See
// docs/adr/0001-step-export-library.md for why this is the chosen approach.
//
// Pinned v1.1.1 quirks (each has a regression test; see the ADR):
//   - `STEPControl_Writer.Write(path)` corrupts paths longer than 10 chars.
//     We use '/t.step' internally and discard it after readFile.
//   - `BRepBuilderAPI_Sewing` requires all 5 ctor args explicitly.
//   - `sewing.Perform(...)` requires `Handle_Message_ProgressIndicator_1()`;
//     JS `null` is rejected.
//   - The right overloads, discovered by probe:
//       gp_Pnt_3, BRepBuilderAPI_MakeEdge_3, BRepBuilderAPI_MakeWire_4,
//       BRepBuilderAPI_MakeFace_15, STEPControl_Writer_1.
//   - Vite can't resolve `import wasm from "./*.wasm"` — we bypass
//     opencascade.js's top-level index.js and feed raw bytes via wasmBinary.

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportStepOptions {
  /**
   * Sewing tolerance in model units (mm). Adjacent triangle vertices within
   * this distance are treated as coincident. OCCT default is 1e-6; we use
   * 1e-3 because our meshes are in mm and sub-micron tolerance rejects
   * meshes with tiny numerical noise.
   */
  tolerance?: number;

  /**
   * Soft limit on triangle count. If the mesh has more triangles than this,
   * we reject rather than produce an enormous STEP file. Callers can raise
   * it if they know what they're asking for. Default: 100_000 (→ ~100 MB
   * STEP file worst case).
   */
  maxTriangles?: number;
}

const DEFAULT_TOLERANCE = 1e-3;
const DEFAULT_MAX_TRIANGLES = 100_000;

// ─────────────────────────────────────────────────────────────────────────────
// OCP loader (lazy singleton, mirrors manifoldBridge.getManifold pattern)
// ─────────────────────────────────────────────────────────────────────────────

// `any`: opencascade.js v1.1.1 ships auto-generated TS types that don't cover
// most overloads we use. Typing each overload would be more misleading than
// helpful. Mirrors manifoldBridge's approach.
let ocpModule: any = null;

/**
 * Load opencascade.js and return the initialised module. First call fetches
 * the 66 MB WASM binary (slow — seconds on a fast connection). Subsequent
 * calls return the cached module.
 *
 * Test-environment (Node + vitest) and production-environment (Electron
 * renderer / browser) differ in how the WASM binary is loaded:
 *   - Node: read from node_modules via `fs.readFileSync`.
 *   - Browser/Electron: fetch the bundled asset URL.
 *
 * Both paths feed bytes to the factory via `wasmBinary`, which bypasses the
 * package's broken (for Vite) `import wasm from "./*.wasm"` pattern.
 */
export async function getOCP(): Promise<any> {
  if (ocpModule) return ocpModule;

  const mod: any = await import('opencascade.js/dist/opencascade.wasm.js');
  const Factory = mod.default;

  let wasmBinary: ArrayBuffer | Uint8Array;

  // Detect Node: `process.versions.node` is set in vitest (happy-dom sets a
  // window too, but happy-dom doesn't shim out Node's `process`) and in
  // Electron main. NOT set in the browser or in Electron's renderer when
  // context isolation is on (which is our config).
  const isNode =
    typeof process !== 'undefined' &&
    typeof (process as any).versions?.node === 'string';

  if (isNode) {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // __dirname is not available under ESM vitest; use process.cwd() which
    // is always the repo root in our test setup.
    const cwd = (process as any).cwd();
    const wasmPath = resolve(
      cwd,
      'node_modules/opencascade.js/dist/opencascade.wasm.wasm',
    );
    wasmBinary = readFileSync(wasmPath);
  } else {
    // In the renderer, Vite rewrites `new URL('...', import.meta.url)` to a
    // bundle-relative URL. Works for both `file://` (Electron) and `http(s)://`
    // (dev server / GitHub Pages build).
    const wasmUrl = new URL(
      '../../../node_modules/opencascade.js/dist/opencascade.wasm.wasm',
      import.meta.url,
    );
    const res = await fetch(wasmUrl.href);
    if (!res.ok) {
      throw new Error(
        `Failed to load OCP WASM (${res.status} ${res.statusText}): ${wasmUrl.href}`,
      );
    }
    wasmBinary = await res.arrayBuffer();
  }

  ocpModule = await Factory({ wasmBinary });
  return ocpModule;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mesh → faceted BRep → STEP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export a BufferGeometry as an ISO 10303-21 STEP file.
 *
 * Returns an ArrayBuffer of STEP text bytes. The caller is responsible for
 * offering a download / save dialog.
 *
 * Runtime cost: dominated by the per-triangle BRep construction (~2-3ms per
 * triangle) and the initial WASM load on first call. A 10k-triangle mesh
 * takes ~20-30 seconds after warm-up. Run off the main thread if you care
 * about responsiveness.
 *
 * @throws if the mesh has more than `options.maxTriangles` triangles.
 * @throws if sewing produces a null shell (bad topology — should not happen
 *   for Manifold-sourced meshes but can happen for user-imported STL).
 */
export async function exportSTEP(
  geometry: THREE.BufferGeometry,
  options: ExportStepOptions = {},
): Promise<ArrayBuffer> {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxTriangles = options.maxTriangles ?? DEFAULT_MAX_TRIANGLES;

  // Non-indexed → one (position) triple per vertex, three verts per triangle.
  // Matches what manifoldToGeometry produces, and STEP export doesn't benefit
  // from indexing (we rebuild topology via sewing anyway).
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = geo.attributes.position.array as Float32Array;
  const triangleCount = positions.length / 9;

  if (triangleCount === 0) {
    throw new Error('exportSTEP: mesh has no triangles');
  }
  if (triangleCount > maxTriangles) {
    throw new Error(
      `exportSTEP: mesh has ${triangleCount} triangles (max ${maxTriangles}). ` +
        `Raise options.maxTriangles or decimate the mesh before export.`,
    );
  }

  const oc = await getOCP();

  // Collect faces into a Sewing instance. We build one face per triangle; the
  // sewer stitches coincident edges between faces into a proper shell.
  const sewing = new oc.BRepBuilderAPI_Sewing(
    tolerance,
    true, // option_1: stitch edges based on parameterisation
    true, // option_2: cutting (subdivide at T-junctions)
    true, // option_3: check same-point (merge coincident verts)
    false, // option_4: non-manifold output (we want a manifold shell)
  );

  for (let t = 0; t < triangleCount; t++) {
    const i0 = t * 9;
    const i1 = i0 + 3;
    const i2 = i0 + 6;

    const p0 = new oc.gp_Pnt_3(positions[i0], positions[i0 + 1], positions[i0 + 2]);
    const p1 = new oc.gp_Pnt_3(positions[i1], positions[i1 + 1], positions[i1 + 2]);
    const p2 = new oc.gp_Pnt_3(positions[i2], positions[i2 + 1], positions[i2 + 2]);

    // Build 3 edges, a wire around them, then a planar face.
    const e01 = new oc.BRepBuilderAPI_MakeEdge_3(p0, p1).Edge();
    const e12 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2).Edge();
    const e20 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p0).Edge();
    const wire = new oc.BRepBuilderAPI_MakeWire_4(e01, e12, e20).Wire();
    const face = new oc.BRepBuilderAPI_MakeFace_15(wire, true).Face();

    if (face.IsNull()) {
      throw new Error(`exportSTEP: failed to build face for triangle ${t}`);
    }

    sewing.Add(face);
  }

  // Perform wants a Handle_Message_ProgressIndicator_1 (v1.1.1 quirk; JS null
  // is explicitly rejected by the binding). Default-constructed handle is a
  // null-pointer wrapper — OCCT treats it as "no progress reporting".
  sewing.Perform(new oc.Handle_Message_ProgressIndicator_1());
  const shell = sewing.SewedShape();
  if (!shell || shell.IsNull()) {
    throw new Error(
      'exportSTEP: sewing produced a null shape — mesh topology likely bad',
    );
  }

  // Shell → STEP. STEPControl_AsIs means "write the BRep in its native form"
  // (as opposed to a faceted dump). With AP214 as the default schema, every
  // tested importer (FreeCAD, Fusion, Onshape) recognises the output.
  const writer = new oc.STEPControl_Writer_1();
  writer.Transfer(shell, oc.STEPControl_StepModelType.STEPControl_AsIs, true);

  // See the ADR: filenames > 10 chars get scribbled by the emscripten binding.
  // '/t.step' is purely an internal key into the in-memory FS — the user-
  // chosen save path is handled by the caller, not by us.
  const internalPath = '/t.step';
  writer.Write(internalPath);

  const bytes: Uint8Array = oc.FS.readFile(internalPath);
  oc.FS.unlink(internalPath);

  // Copy into a standalone ArrayBuffer — the Uint8Array returned from FS
  // shares its buffer with emscripten's heap, which is unsafe to hand to
  // callers (heap can grow and invalidate the view).
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
