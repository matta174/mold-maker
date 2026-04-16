import { describe, it, expect } from 'vitest';
import { createZip } from './minizip';

/**
 * These tests intentionally treat `createZip` as a black box — we don't
 * re-implement ZIP parsing inside the test. Instead we pin well-known byte
 * patterns (PK signatures) and cross-check the CRC-32 of a known payload
 * against the value from an independent source (the Python zlib reference).
 */

describe('createZip', () => {
  it('emits the PK\\x03\\x04 local file header signature at offset 0', () => {
    const buf = createZip({ 'hello.txt': 'hello' });
    const view = new DataView(buf);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
  });

  it('ends with the PK\\x05\\x06 End-Of-Central-Directory signature', () => {
    const buf = createZip({ 'hello.txt': 'hello' });
    const view = new DataView(buf);
    const eocdStart = buf.byteLength - 22;
    expect(view.getUint32(eocdStart, true)).toBe(0x06054b50);
  });

  it('records the correct CRC-32 for the known input "hello"', () => {
    const buf = createZip({ 'hello.txt': 'hello' });
    const view = new DataView(buf);
    // CRC-32 of ASCII "hello" is 0x3610a686 (verified via python zlib.crc32).
    // Local file header CRC is at offset 14 in the local file header.
    expect(view.getUint32(14, true)).toBe(0x3610a686);
  });

  it('records the correct CRC-32 for an empty payload', () => {
    const buf = createZip({ 'empty.txt': '' });
    const view = new DataView(buf);
    // CRC-32 of empty bytes is 0
    expect(view.getUint32(14, true)).toBe(0);
    // Uncompressed size is also 0
    expect(view.getUint32(22, true)).toBe(0);
  });

  it('stores multiple entries with ascending local header offsets', () => {
    const buf = createZip({
      'a.txt': 'alpha',
      'b.txt': 'beta',
    });
    const view = new DataView(buf);
    // First entry at offset 0
    expect(view.getUint32(0, true)).toBe(0x04034b50);

    // Second entry starts after first: 30 + name(5) + data(5) = 40
    expect(view.getUint32(40, true)).toBe(0x04034b50);
  });

  it('stores filename and data verbatim (no compression)', () => {
    const buf = createZip({ 'hello.txt': 'world!' });
    const bytes = new Uint8Array(buf);
    const decoder = new TextDecoder();

    // Filename is at offset 30 (after 30-byte local header)
    const name = decoder.decode(bytes.slice(30, 30 + 9)); // "hello.txt"
    expect(name).toBe('hello.txt');

    // Data immediately follows
    const data = decoder.decode(bytes.slice(30 + 9, 30 + 9 + 6)); // "world!"
    expect(data).toBe('world!');
  });
});
