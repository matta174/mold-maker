// REGRESSION GUARD for opencascade.js v1.1.1 emscripten filename-length bug.
//
// STEPControl_Writer.Write(filename) corrupts the path argument when
// `filename.length > 10`. Empirically pinned: filenames of 10 chars or
// fewer (e.g. "/boxA.step") write cleanly; 11+ chars (e.g. "/spike.step")
// get scribbled to garbage bytes before OCCT even sees them ("Step File
// Name : P󁁐(...)"). Looks like a fixed-size stack-allocated buffer in
// the emscripten bindings that doesn't handle longer strings.
//
// Our production code in exporters.ts uses a short internal path
// (e.g. '/t.step') and throws it away after reading the bytes back out
// of the emscripten FS, so this isn't user-visible. This test pins the
// bug so that if a future opencascade.js release fixes it — or more
// importantly, changes the threshold — we notice immediately.
//
// If this test starts failing after a dependency bump: either the bug
// is fixed (great — we can simplify exportSTEP) or the threshold has
// moved. Update the internal filename used by exportSTEP accordingly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('opencascade.js v1.1.1: STEPControl_Writer filename-length bug', () => {
  it('10-char filenames write cleanly; 11+ corrupt (pinned bug)', async () => {
    const mod: any = await import('opencascade.js/dist/opencascade.wasm.js');
    const wasmPath = resolve(
      __dirname,
      '../../../node_modules/opencascade.js/dist/opencascade.wasm.wasm',
    );
    const oc: any = await mod.default({ wasmBinary: readFileSync(wasmPath) });

    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const mkBox = new oc.BRepPrimAPI_MakeBox_2(origin, 10, 20, 30);
    const shape = mkBox.Shape();

    function tryWrite(filename: string): boolean {
      const writer = new oc.STEPControl_Writer_1();
      writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
      writer.Write(filename);
      const basename = filename.replace(/^\//, '');
      const root: string[] = oc.FS.readdir('/');
      const ok = root.includes(basename);
      if (ok) {
        try { oc.FS.unlink(filename); } catch { /* ignore */ }
      }
      return ok;
    }

    // Boundary: 10 chars works, 11+ fails.
    expect(tryWrite('/boxA.step')).toBe(true);    // 10 chars
    expect(tryWrite('/cube.step')).toBe(true);    // 10 chars
    expect(tryWrite('/cubeA.step')).toBe(false);  // 11 chars — corrupts
    expect(tryWrite('/spike.step')).toBe(false);  // 11 chars — corrupts
    expect(tryWrite('/abcdefghijklmno.step')).toBe(false); // 21 chars — corrupts
  }, 60_000);
});
