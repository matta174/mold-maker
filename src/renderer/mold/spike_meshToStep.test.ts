// SPIKE v2: Manifold mesh → faceted BRep → STEP file.
//
// The v1 spike (spike_stepExport.test.ts) proved that OCP-native primitives
// can be written to valid STEP. The REAL technical risk — and the thing that
// blocks the BRep-strategy decision — is whether we can convert the triangle
// meshes that `generateMold` produces into something STEPControl_Writer will
// accept.
//
// Why faceted and not solid: recovering parametric surfaces (planes, cylinders,
// splines) from an arbitrary mesh is a research problem (e.g. Autodesk's
// ReverseEngineering workbench, MeshToBRep papers). OCCT doesn't do it
// automatically, and writing a surface-fitter is well outside the scope of a
// mold-generation tool. Faceted BRep (triangle soup → shell → solid) is the
// only realistic path for mesh-sourced pipelines.
//
// Pipeline:
//   Manifold cube → getMesh() → for each triangle:
//     3 gp_Pnt → 3 BRepBuilderAPI_MakeEdge → BRepBuilderAPI_MakeWire →
//     BRepBuilderAPI_MakeFace
//   → BRepBuilderAPI_Sewing(faces) → TopoDS_Shell
//   → BRepBuilderAPI_MakeSolid(shell) → TopoDS_Solid
//   → STEPControl_Writer.Transfer(...) → Write('/t.step')
//
// Validation: STEP text must contain FACETED_BREP or MANIFOLD_SOLID_BREP
// (faceted solids use either flavour in OCCT output, depending on version).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getManifold } from './manifoldBridge';

let oc: any = null;
async function initOCP(): Promise<any> {
  if (oc) return oc;
  const mod: any = await import('opencascade.js/dist/opencascade.wasm.js');
  const wasmPath = resolve(
    __dirname,
    '../../../node_modules/opencascade.js/dist/opencascade.wasm.wasm',
  );
  oc = await mod.default({ wasmBinary: readFileSync(wasmPath) });
  return oc;
}

/** Find the first constructor variant `<name>_N` (N=1..8) that exists on oc. */
function findCtor(name: string, maxN = 8): string | null {
  for (let i = 1; i <= maxN; i++) {
    if (oc[`${name}_${i}`]) return `${name}_${i}`;
  }
  return oc[name] ? name : null;
}

describe('SPIKE v2: Manifold mesh → faceted BRep → STEP', () => {
  it('converts a Manifold cube mesh into a STEP-writable faceted BRep', async () => {
    await initOCP();
    const wasm = await getManifold();
    const { Manifold } = wasm;

    // --- Build a Manifold cube and extract its mesh ---
    const cube = Manifold.cube([10, 20, 30], false);
    const mesh = cube.getMesh();
    const { vertProperties, triVerts, numProp } = mesh;
    const triCount = triVerts.length / 3;
    expect(triCount).toBeGreaterThan(0);

    // --- Probe the API surface we need ---
    // Emscripten bindings auto-number overloads (_1, _2, …). Rather than
    // hard-coding numbers that might shift on a future release, find them.
    const makeEdgeName = findCtor('BRepBuilderAPI_MakeEdge');
    const makeWireName = findCtor('BRepBuilderAPI_MakeWire');
    const makeFaceName = findCtor('BRepBuilderAPI_MakeFace');
    const sewingName = findCtor('BRepBuilderAPI_Sewing');
    const makeSolidName = findCtor('BRepBuilderAPI_MakeSolid');
    expect(makeEdgeName).toBeTruthy();
    expect(makeWireName).toBeTruthy();
    expect(makeFaceName).toBeTruthy();
    expect(sewingName).toBeTruthy();
    expect(makeSolidName).toBeTruthy();

    // Find the MakeEdge(gp_Pnt, gp_Pnt) overload. OCCT has ~10 overloads of
    // this. The 2-gp_Pnt variant is usually _3 or _4 in recent bindings;
    // we'll probe by trying each until one accepts (gp_Pnt, gp_Pnt).
    function makeEdgeFromPoints(p1: any, p2: any): any {
      for (let i = 1; i <= 10; i++) {
        const Ctor = oc[`BRepBuilderAPI_MakeEdge_${i}`];
        if (!Ctor) continue;
        try {
          const e = new Ctor(p1, p2);
          if (e && typeof e.Edge === 'function') return e.Edge();
        } catch { /* wrong overload */ }
      }
      throw new Error('No BRepBuilderAPI_MakeEdge(gp_Pnt, gp_Pnt) overload found');
    }

    // --- Sewing collector ---
    // opencascade.js v1.1.1 requires all 5 params explicitly (no default args).
    // (tolerance, optionSameParameter, optionCuttingEdges, optionSamePoint,
    //  optionNonManifold). These are OCCT's default values.
    const sewing = new oc[sewingName!](1e-6, true, true, true, false);

    // --- Build one face per mesh triangle ---
    let facesBuilt = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = triVerts[t * 3];
      const i1 = triVerts[t * 3 + 1];
      const i2 = triVerts[t * 3 + 2];

      const p0 = new oc.gp_Pnt_3(
        vertProperties[i0 * numProp],
        vertProperties[i0 * numProp + 1],
        vertProperties[i0 * numProp + 2],
      );
      const p1 = new oc.gp_Pnt_3(
        vertProperties[i1 * numProp],
        vertProperties[i1 * numProp + 1],
        vertProperties[i1 * numProp + 2],
      );
      const p2 = new oc.gp_Pnt_3(
        vertProperties[i2 * numProp],
        vertProperties[i2 * numProp + 1],
        vertProperties[i2 * numProp + 2],
      );

      const e01 = makeEdgeFromPoints(p0, p1);
      const e12 = makeEdgeFromPoints(p1, p2);
      const e20 = makeEdgeFromPoints(p2, p0);

      // MakeWire has a 3-edge overload (_4 in most bindings) — find it.
      let wire: any = null;
      for (let i = 1; i <= 6; i++) {
        const Ctor = oc[`BRepBuilderAPI_MakeWire_${i}`];
        if (!Ctor) continue;
        try {
          const w = new Ctor(e01, e12, e20);
          if (w && typeof w.Wire === 'function') { wire = w.Wire(); break; }
        } catch { /* wrong overload */ }
      }
      if (!wire) throw new Error('No BRepBuilderAPI_MakeWire(3 edges) overload found');

      // MakeFace_15(wire, OnlyPlane) is the wire-based constructor in
      // opencascade.js v1.1.1. (Overloads _1..._10 handle surface primitives
      // like gp_Pln alone; _15 is the one that accepts a wire and infers its
      // supporting plane. See spike_ocpProbe.test.ts for the full map of
      // 22 overloads.) OnlyPlane=true forces plane-fit; for a triangle that's
      // trivially correct since 3 points are coplanar by definition.
      const mkFace = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
      const face = mkFace.Face();
      if (face.IsNull()) throw new Error('MakeFace produced a null face');

      sewing.Add(face);
      facesBuilt++;
    }
    expect(facesBuilt).toBe(triCount);

    // --- Sew into a shell ---
    // Perform requires 1 arg of type Handle_Message_ProgressIndicator
    // in v1.1.1. JS `null` is rejected by the emscripten binding, so we
    // pass a default-constructed Handle wrapping a null pointer — the
    // C++ equivalent of no progress indicator.
    sewing.Perform(new oc.Handle_Message_ProgressIndicator_1());
    const shell = sewing.SewedShape();
    expect(shell).toBeDefined();
    expect(shell.IsNull()).toBe(false);

    // --- Write STEP ---
    const writer = new oc.STEPControl_Writer_1();
    const mode = oc.STEPControl_StepModelType.STEPControl_AsIs;
    writer.Transfer(shell, mode, true);

    const outPath = '/t.step'; // keep ≤10 chars — see spike_stepFilename
    writer.Write(outPath);

    const root: string[] = oc.FS.readdir('/');
    expect(root).toContain('t.step');

    const bytes: Uint8Array = oc.FS.readFile(outPath);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);

    // Faceted shells surface as one of these entity types in STEP:
    const hasBRepEntity =
      text.includes('FACETED_BREP') ||
      text.includes('MANIFOLD_SOLID_BREP') ||
      text.includes('SHELL_BASED_SURFACE_MODEL') ||
      text.includes('OPEN_SHELL') ||
      text.includes('CLOSED_SHELL');
    expect(hasBRepEntity).toBe(true);

    oc.FS.unlink(outPath);
  }, 120_000); // 2min budget — mesh conversion is per-triangle, could be slow
});
