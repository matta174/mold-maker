import { describe, it, expect } from 'vitest';
import { parseModel } from './fileLoader';

/**
 * Build a minimal valid binary STL (1 triangle) for happy-path testing.
 * Layout: 80-byte header + 4-byte count + 50 bytes per triangle.
 */
function tinyBinarySTL(): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50);
  const view = new DataView(buf);
  view.setUint32(80, 1, true);

  // Normal + 3 vertices, 12 bytes each, then 2-byte attribute count
  // Normal (0, 0, 1)
  view.setFloat32(84 + 8, 1, true);
  // v0 (0, 0, 0) — already zero
  // v1 (1, 0, 0)
  view.setFloat32(84 + 12 + 12, 1, true);
  // v2 (0, 1, 0)
  view.setFloat32(84 + 12 + 24 + 4, 1, true);

  return buf;
}

describe('parseModel', () => {
  it('throws a user-facing error for unsupported extensions', () => {
    const buf = new ArrayBuffer(0);
    expect(() => parseModel(buf, 'mystery.xyz')).toThrow(/Unsupported file type/);
    expect(() => parseModel(buf, 'mystery.xyz')).toThrow(/\.stl or \.obj/);
  });

  it('throws when there is no extension at all', () => {
    const buf = new ArrayBuffer(0);
    expect(() => parseModel(buf, 'no-extension')).toThrow(/Unsupported file type/);
  });

  it('wraps loader failures with filename context', () => {
    // A 4-byte buffer is not a valid STL (header needs 80 bytes). STLLoader
    // should throw; parseModel should wrap the error with the filename.
    const bogus = new ArrayBuffer(4);
    expect(() => parseModel(bogus, 'broken.stl')).toThrow(/Failed to parse broken\.stl/);
  });

  it('parses a minimal valid binary STL', () => {
    const result = parseModel(tinyBinarySTL(), 'tiny.stl');
    expect(result.fileName).toBe('tiny.stl');
    expect(result.geometry).toBeDefined();
    const posAttr = result.geometry.attributes.position;
    // One triangle = 3 vertices × 3 components = 9 floats
    expect(posAttr.array.length).toBe(9);
  });

  it('is case-insensitive on extension', () => {
    const result = parseModel(tinyBinarySTL(), 'TINY.STL');
    expect(result.geometry.attributes.position.array.length).toBe(9);
  });

  it('parses OBJ content', () => {
    const objText = '# simple\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
    const buf = new TextEncoder().encode(objText).buffer;
    const result = parseModel(buf, 'simple.obj');
    expect(result.fileName).toBe('simple.obj');
    // OBJLoader will parse this into a Group; mergeObjGeometries extracts positions.
    const posAttr = result.geometry.attributes.position;
    expect(posAttr).toBeDefined();
  });
});
