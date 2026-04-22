// SPIKE: verify opencascade.js v1.1.1 can produce a valid STEP file.
//
// Kill gate for the STEP export feature. We need to confirm THREE things
// before committing to the full implementation:
//   1. The WASM loads and initialises in a happy-dom test environment
//      (if it can't load here, it won't load in Electron's renderer either
//      without non-trivial CSP work)
//   2. OCP can be driven from JS to produce a shape (BRepPrimAPI_MakeBox)
//   3. STEPControl_Writer emits a byte-valid ISO-10303-21 file that starts
//      and ends with the correct magic markers
//
// Intentionally does NOT test mesh-to-BRep conversion yet — that's the
// v2 spike. If we can't get OCP's own primitive cube → STEP working,
// there's no point trying to convert arbitrary Manifold meshes.
//
// Runtime budget: first run may take 10-30s to load the 66MB WASM.
// Subsequent runs should be faster due to module caching.
//
// SINGLE-TEST STRUCTURE: earlier versions of this spike split the probe
// into three `it()` blocks (load / make box / write). That triggered
// cross-test state corruption inside the shared emscripten module —
// test 2's orphaned box handle apparently scribbled on the heap region
// STEPControl_Writer.Write() reads its filename from, producing
// garbage-byte filenames like `P󁁐` and a missing output file. The
// standalone probe (spike_stepProbe.test.ts) never reproduced it
// because it did the entire flow in one test. So we do the same here:
// one test, one OCP instance, full load → box → write → validate flow.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('SPIKE: opencascade.js v1.1.1 STEP export', () => {
  it('loads WASM, builds a box, writes a valid ISO-10303-21 STEP file', async () => {
    // --- Load WASM ---
    //
    // We bypass opencascade.js's top-level `index.js` because it does
    //   `import wasmFile from "./dist/opencascade.wasm.wasm"`
    // which Vite's module resolver cannot handle — it tries to parse the
    // WASM as JS and fails with a bogus "Cannot find package 'a'" error.
    //
    // Instead, we hit the underlying emscripten-generated JS directly and
    // feed it the raw WASM bytes via `wasmBinary`. That works in both
    // Node-under-vitest and the Electron renderer.
    const mod: any = await import('opencascade.js/dist/opencascade.wasm.js');
    const Factory = mod.default;

    const wasmPath = resolve(
      __dirname,
      '../../../node_modules/opencascade.js/dist/opencascade.wasm.wasm',
    );
    const wasmBinary = readFileSync(wasmPath);
    const oc: any = await Factory({ wasmBinary });

    expect(oc).toBeDefined();
    expect(oc.BRepPrimAPI_MakeBox_2).toBeDefined();
    expect(oc.STEPControl_Writer_1 ?? oc.STEPControl_Writer).toBeDefined();
    expect(oc.FS).toBeDefined(); // emscripten virtual FS — needed for output

    // --- Build a box ---
    //
    // opencascade.js v1.1.1 exposes 4 overloads but no pure 3-scalar form:
    //   _1: no-arg; _2: (gp_Pnt origin, dx, dy, dz);
    //   _3: (gp_Pnt p1, gp_Pnt p2); _4: (gp_Ax2 axes, dx, dy, dz).
    // Use _2 with an origin at (0,0,0). gp_Pnt_3 is the (x,y,z) overload.
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const mkBox = new oc.BRepPrimAPI_MakeBox_2(origin, 10, 20, 30);
    const shape = mkBox.Shape();
    expect(shape.IsNull()).toBe(false);

    // --- Configure writer + transfer shape ---
    //
    // STEPControl_Writer_1 is the default constructor. _2 takes extra args
    // we don't need for a single-shape write.
    const writer = new oc.STEPControl_Writer_1();

    // Transfer mode: the enum lives on STEPControl_StepModelType. AsIs means
    // "write the shape in its native BRep form" — the right default for
    // solid CAD data (as opposed to a faceted dump).
    const mode = oc.STEPControl_StepModelType.STEPControl_AsIs;

    // opencascade.js v1.1.1 exposes Transfer(shape, mode, compgraph).
    // `compgraph=true` is the default in OCCT — emits a compound-graph style
    // representation that's what every importer (Fusion, FreeCAD) expects.
    // Message_ProgressRange is newer and not in v1.1.1 (probe confirmed).
    writer.Transfer(shape, mode, true);

    // --- Write to the in-memory emscripten FS ---
    //
    // Write() expects a plain JS string — wrapping it in TCollection_AsciiString
    // throws "Cannot pass non-string to std::string" because the emscripten
    // binding does the conversion itself.
    //
    // ⚠ FILENAME LENGTH LIMIT: opencascade.js v1.1.1 has a bug where
    // `writer.Write(filename)` corrupts the argument when filename.length > 10.
    // OCCT logs "Step File Name : <garbage-bytes>" and nothing materialises.
    // We keep this path ≤10 chars and throw it away after readFile — the
    // emscripten FS filename is just a transient lookup key. See
    // spike_stepFilename.test.ts for the pinned boundary behaviour.
    const outPath = '/t.step'; // 7 chars
    writer.Write(outPath);

    // Confirm it actually materialised before we try to read it.
    const rootListing: string[] = oc.FS.readdir('/');
    expect(rootListing).toContain('t.step');

    const bytes: Uint8Array = oc.FS.readFile(outPath);
    expect(bytes.byteLength).toBeGreaterThan(0);

    // --- Validate ISO-10303-21 structure ---
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toContain('HEADER;');
    expect(text).toContain('DATA;');
    expect(text).toContain('ENDSEC;');
    expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);

    // A box should produce at least one MANIFOLD_SOLID_BREP or equivalent
    // B-rep entity. If the writer succeeds but emits an empty DATA section,
    // the file is technically valid but useless.
    const hasSolidEntity =
      text.includes('MANIFOLD_SOLID_BREP') ||
      text.includes('ADVANCED_BREP_SHAPE_REPRESENTATION') ||
      text.includes('BREP_WITH_VOIDS');
    expect(hasSolidEntity).toBe(true);

    // Clean up FS so repeated runs don't accumulate.
    oc.FS.unlink(outPath);
  }, 60_000);
});
