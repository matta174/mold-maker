import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { xmlAttr, exportSTL, exportOBJ, export3MF } from './exporters';

/**
 * Build a minimal, valid BufferGeometry for export tests — a single triangle.
 * The test only cares about structural correctness of the output, not geometric
 * validity, so one tri is enough.
 */
function oneTriangle(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  // prettier-ignore
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

describe('xmlAttr', () => {
  it('escapes &, <, >, and double-quotes', () => {
    expect(xmlAttr('a & b')).toBe('a &amp; b');
    expect(xmlAttr('<tag>')).toBe('&lt;tag&gt;');
    expect(xmlAttr('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('escapes & FIRST so pre-escaped entities are not double-escaped backwards', () => {
    // Important: if we escaped & last, the output of escaping < would contain
    // &lt; and & → &amp; would then corrupt it to &amp;lt;. Verify order holds.
    expect(xmlAttr('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('leaves ordinary strings untouched', () => {
    expect(xmlAttr('millimeter')).toBe('millimeter');
    expect(xmlAttr('')).toBe('');
  });
});

describe('exportSTL', () => {
  it('produces the binary STL layout: 80-byte header + 4-byte count + 50 bytes per triangle', () => {
    const buf = exportSTL(oneTriangle());
    expect(buf.byteLength).toBe(80 + 4 + 50); // 134 bytes for 1 tri

    const view = new DataView(buf);
    // Triangle count at byte 80, little-endian
    expect(view.getUint32(80, true)).toBe(1);

    // First vertex of the triangle starts at offset 84 + 12 (normal) = 96
    const x = view.getFloat32(96, true);
    const y = view.getFloat32(100, true);
    const z = view.getFloat32(104, true);
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(z).toBe(0);

    // Attribute byte count (last 2 bytes of the triangle record) is always 0
    expect(view.getUint16(132, true)).toBe(0);
  });

  it('scales linearly: N triangles → 84 + 50*N bytes', () => {
    const geo = new THREE.BufferGeometry();
    const N = 5;
    const positions = new Float32Array(N * 9);
    for (let i = 0; i < N * 9; i++) positions[i] = i; // any values
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const buf = exportSTL(geo);
    expect(buf.byteLength).toBe(84 + 50 * N);

    const view = new DataView(buf);
    expect(view.getUint32(80, true)).toBe(N);
  });
});

describe('exportOBJ', () => {
  it('emits header, vertex lines, and 1-indexed face records', () => {
    const buf = exportOBJ(oneTriangle());
    const text = new TextDecoder().decode(buf);
    const lines = text.trimEnd().split('\n');

    expect(lines[0]).toBe('# Mold Maker Export');
    expect(lines[1]).toBe('v 0 0 0');
    expect(lines[2]).toBe('v 1 0 0');
    expect(lines[3]).toBe('v 0 1 0');
    // Faces are 1-indexed per OBJ spec
    expect(lines[4]).toBe('f 1 2 3');
  });
});

describe('export3MF', () => {
  it('produces a ZIP archive (starts with PK signature)', async () => {
    const buf = await export3MF(oneTriangle());
    const view = new DataView(buf);
    // Local file header signature: 0x04034b50, but bytes on disk are "PK\x03\x04"
    expect(view.getUint8(0)).toBe(0x50); // P
    expect(view.getUint8(1)).toBe(0x4b); // K
    expect(view.getUint8(2)).toBe(0x03);
    expect(view.getUint8(3)).toBe(0x04);
  });

  it('ends with End-Of-Central-Directory signature (PK\\x05\\x06)', async () => {
    const buf = await export3MF(oneTriangle());
    const view = new DataView(buf);
    // EOCD is the last 22 bytes of a no-comment ZIP
    const eocdStart = buf.byteLength - 22;
    expect(view.getUint32(eocdStart, true)).toBe(0x06054b50);
  });
});
