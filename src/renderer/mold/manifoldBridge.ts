import * as THREE from 'three';
import { MERGE_TOLERANCE, dbg } from './constants';

// ─────────────────────────────────────────────────────────────────────────────
// Manifold WASM loading
// ─────────────────────────────────────────────────────────────────────────────

// Lazily loaded Manifold WASM module. `any` is justified here — the published
// type definitions don't cover the bridging API we use for mesh import/export.
let manifoldModule: any = null;

export async function getManifold(): Promise<any> {
  if (manifoldModule) return manifoldModule;
  const Module = await import('manifold-3d');
  const wasm = await Module.default();
  if (typeof wasm.setup === 'function') {
    wasm.setup();
  }
  manifoldModule = wasm;
  return manifoldModule;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry ↔ Manifold bridge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a THREE.BufferGeometry to a Manifold mesh.
 *
 * The key challenge: STL files store each triangle independently with its own
 * 3 vertices, even when triangles share vertices. Manifold needs to know which
 * vertices are the same point (shared edges) to form a valid manifold surface.
 *
 * We do this by:
 * 1. Keeping all vertices as-is in vertProperties (non-indexed, 3 verts per tri)
 * 2. Using mergeFromVert/mergeToVert to tell Manifold which verts are coincident
 *    (within a tolerance), so it can reconstruct the mesh topology.
 */
export function geometryToManifold(wasm: any, geometry: THREE.BufferGeometry): any {
  const { Manifold, Mesh } = wasm;

  // Work with non-indexed geometry (STL files are already non-indexed)
  const geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();

  const positions = geo.attributes.position.array as Float32Array;
  const vertCount = positions.length / 3;
  const triCount = vertCount / 3;

  // Build vertProperties (just positions, numProp=3)
  const vertProperties = new Float32Array(positions);

  // triVerts: sequential indices since each triangle owns its 3 verts
  const triVerts = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    triVerts[i] = i;
  }

  // Build merge vectors: find vertices that are at the same position
  // and tell Manifold they should be merged.
  //
  // Distance metric: Euclidean (L2).
  // Bucket size equals the tolerance — a vertex within tolerance of a candidate
  // is always in the candidate's bucket or one of the 26 neighbours, so the
  // 3×3×3 neighbourhood search still covers every possible match.
  const bucketSize = MERGE_TOLERANCE;
  const toleranceSq = MERGE_TOLERANCE * MERGE_TOLERANCE;
  const vertexMap = new Map<string, number[]>();

  const offsets = [-1, 0, 1];
  const mergeFrom: number[] = [];
  const mergeTo: number[] = [];

  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    const bx = Math.round(x / bucketSize);
    const by = Math.round(y / bucketSize);
    const bz = Math.round(z / bucketSize);

    // Search neighboring buckets for a match within tolerance
    let matchIdx = -1;
    outer:
    for (const dx of offsets) {
      for (const dy of offsets) {
        for (const dz of offsets) {
          const key = `${bx + dx},${by + dy},${bz + dz}`;
          const bucket = vertexMap.get(key);
          if (bucket) {
            for (const j of bucket) {
              const ddx = positions[j * 3] - x;
              const ddy = positions[j * 3 + 1] - y;
              const ddz = positions[j * 3 + 2] - z;
              const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
              if (distSq < toleranceSq) {
                matchIdx = j;
                break outer;
              }
            }
          }
        }
      }
    }

    if (matchIdx >= 0) {
      mergeFrom.push(i);
      mergeTo.push(matchIdx);
    }

    // Always insert into the home bucket
    const homeKey = `${bx},${by},${bz}`;
    const homeBucket = vertexMap.get(homeKey);
    if (homeBucket) {
      homeBucket.push(i);
    } else {
      vertexMap.set(homeKey, [i]);
    }
  }

  dbg(`Mesh: ${triCount} triangles, ${vertCount} vertices, ${mergeFrom.length} merge pairs`);

  const mesh = new Mesh({
    numProp: 3,
    vertProperties,
    triVerts,
    mergeFromVert: new Uint32Array(mergeFrom),
    mergeToVert: new Uint32Array(mergeTo),
  });

  return Manifold.ofMesh(mesh);
}

/** Convert a Manifold back to THREE.BufferGeometry. */
export function manifoldToGeometry(manifold: any): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const { vertProperties, triVerts, numProp } = mesh;

  const positions = new Float32Array(triVerts.length * 3);
  for (let i = 0; i < triVerts.length; i++) {
    const vi = triVerts[i];
    positions[i * 3] = vertProperties[vi * numProp];
    positions[i * 3 + 1] = vertProperties[vi * numProp + 1];
    positions[i * 3 + 2] = vertProperties[vi * numProp + 2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

/** Create a box manifold with one corner at (offsetX, offsetY, offsetZ). */
export function createBox(
  wasm: any,
  sizeX: number, sizeY: number, sizeZ: number,
  offsetX = 0, offsetY = 0, offsetZ = 0,
): any {
  const { Manifold } = wasm;
  return Manifold.cube([sizeX, sizeY, sizeZ], false)
    .translate([offsetX, offsetY, offsetZ]);
}
