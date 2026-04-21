import { describe, it, expect } from 'vitest';
import { EmptyManifoldError, manifoldToGeometry } from './manifoldBridge';

// The full geometryToManifold / Manifold.cylinder path runs WASM, which is
// out of scope for happy-dom unit tests. These tests cover the pure-JS
// guard that sits between Manifold output and the React render path — the
// one that previously let empty CSG results silently reach the viewport
// as a zero-vertex mesh ("regenerate nukes the mold").

function fakeManifold(triVerts: number[], vertProperties: number[] = []): unknown {
  return {
    getMesh() {
      return {
        triVerts: new Uint32Array(triVerts),
        vertProperties: new Float32Array(vertProperties),
        numProp: 3,
      };
    },
  };
}

describe('manifoldToGeometry', () => {
  it('throws EmptyManifoldError when the CSG result has zero triangles', () => {
    const m = fakeManifold([]);
    expect(() => manifoldToGeometry(m)).toThrow(EmptyManifoldError);
  });

  it('error message mentions parting plane and watertightness (actionable hints for the user)', () => {
    const m = fakeManifold([]);
    try {
      manifoldToGeometry(m);
      throw new Error('did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EmptyManifoldError);
      expect((err as Error).message).toMatch(/parting plane/i);
      expect((err as Error).message).toMatch(/watertight/i);
    }
  });

  it('passes through a non-empty mesh to a BufferGeometry with computed normals', () => {
    // Minimum viable triangle: 3 verts, 1 tri.
    const m = fakeManifold(
      [0, 1, 2],
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
    );
    const geo = manifoldToGeometry(m);
    expect(geo.attributes.position.count).toBe(3);
    // computeVertexNormals runs for normal-based shading and STL export.
    expect(geo.attributes.normal).toBeDefined();
    expect(geo.attributes.normal.count).toBe(3);
  });
});
