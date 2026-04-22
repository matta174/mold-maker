// Tests pinning the user-facing error catalog. The point of this file is to
// make "did someone silently drop a mapping?" a test failure, not a bug
// report from a user who saw a raw "sewing produced a null shape" banner.
//
// When you add a new throw-site to exportSTEP or its dependencies:
//   1. Add a case here that asserts the friendly translation.
//   2. If the raw message isn't covered by an existing rule, ADD a rule
//      rather than updating one (fallthrough = pass-through is intentional,
//      see module header).

import { describe, it, expect } from 'vitest';
import { translateStepError } from './stepExportErrors';

describe('translateStepError', () => {
  it('rewrites "no triangles" to actionable click-generate guidance', () => {
    const out = translateStepError('exportSTEP: mesh has no triangles');
    expect(out).toMatch(/Generate Mold/i);
    expect(out).not.toMatch(/exportSTEP/);
  });

  it('echoes triangle counts in the too-detailed message', () => {
    const raw = 'exportSTEP: mesh has 250000 triangles (max 100000). Raise options.maxTriangles or decimate the mesh before export.';
    const out = translateStepError(raw);
    expect(out).toContain('250000');
    expect(out).toContain('100000');
    // Offers an alternative format rather than a dead end.
    expect(out).toMatch(/STL|3MF/);
  });

  it('translates WASM load failures with the HTTP status', () => {
    const raw = 'Failed to load OCP WASM (404 Not Found): http://example.com/x.wasm';
    const out = translateStepError(raw);
    expect(out).toContain('404');
    expect(out).toContain('Not Found');
    // Mentions the one-time nature so the user knows subsequent tries are faster.
    expect(out).toMatch(/first use|only.*once|only downloads/i);
  });

  it('translates the null-shape / bad-topology message to mesh-repair guidance', () => {
    const raw = 'exportSTEP: sewing produced a null shape — mesh topology likely bad';
    const out = translateStepError(raw);
    expect(out).not.toMatch(/null shape/i);
    expect(out).toMatch(/Blender|Meshmixer|STL/i);
  });

  it('translates "failed to build face" to non-manifold guidance', () => {
    const raw = 'exportSTEP: failed to build face for triangle 1234';
    const out = translateStepError(raw);
    expect(out).toMatch(/non-manifold|repair|STL/i);
  });

  it('translates worker crashes to retry-and-report guidance', () => {
    const raw = 'STEP export worker crashed';
    const out = translateStepError(raw);
    expect(out).toMatch(/crashed|try again|report/i);
    expect(out).toMatch(/STL|3MF/);
  });

  it('translates OOM-ish messages', () => {
    // Covers both emscripten's "out of memory" abort and V8's RangeError.
    expect(translateStepError('Aborted(out of memory)')).toMatch(/memory/i);
    expect(
      translateStepError('RangeError: Array buffer allocation failed'),
    ).toMatch(/memory/i);
  });

  it('passes through unrecognised errors unchanged (no hidden "something went wrong")', () => {
    const raw = 'some entirely novel error from a future dependency';
    expect(translateStepError(raw)).toBe(raw);
  });

  it('normalises the cancellation sentinel (defensive — upstream already suppresses it)', () => {
    expect(translateStepError('Export cancelled')).toBe('STEP export cancelled.');
  });
});
