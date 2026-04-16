import { useCallback } from 'react';
import * as THREE from 'three';
import type { Axis } from '../App';

// We'll use Manifold for CSG boolean ops
let manifoldModule: any = null;

async function getManifold() {
  if (manifoldModule) return manifoldModule;
  const Module = await import('manifold-3d');
  const wasm = await Module.default();
  // Ensure the module is fully initialized
  if (typeof wasm.setup === 'function') {
    wasm.setup();
  }
  manifoldModule = wasm;
  return manifoldModule;
}

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
function geometryToManifold(wasm: any, geometry: THREE.BufferGeometry) {
  const { Manifold, Mesh } = wasm;

  // Work with non-indexed geometry (STL files are already non-indexed)
  let geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();

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
  // This is what allows Manifold to reconstruct the topology from an STL.
  const tolerance = 1e-5;
  const mergeFrom: number[] = [];
  const mergeTo: number[] = [];

  // Spatial hash for fast vertex matching.
  // We check the current bucket AND all 26 neighbors to avoid missing vertices
  // that are within tolerance but straddle a bucket boundary.
  const bucketSize = tolerance * 10;
  const vertexMap = new Map<string, number[]>();

  const offsets = [-1, 0, 1];

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
              const dist = Math.abs(positions[j * 3] - x)
                + Math.abs(positions[j * 3 + 1] - y)
                + Math.abs(positions[j * 3 + 2] - z);
              if (dist < tolerance) {
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

  console.log(`Mesh: ${triCount} triangles, ${vertCount} vertices, ${mergeFrom.length} merge pairs`);

  const mesh = new Mesh({
    numProp: 3,
    vertProperties,
    triVerts,
    mergeFromVert: new Uint32Array(mergeFrom),
    mergeToVert: new Uint32Array(mergeTo),
  });

  return Manifold.ofMesh(mesh);
}

/**
 * Convert a Manifold back to THREE.BufferGeometry
 */
function manifoldToGeometry(manifold: any): THREE.BufferGeometry {
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

/**
 * Create a box manifold
 */
function createBox(wasm: any, sizeX: number, sizeY: number, sizeZ: number, offsetX = 0, offsetY = 0, offsetZ = 0) {
  const { Manifold } = wasm;
  return Manifold.cube([sizeX, sizeY, sizeZ], false)
    .translate([offsetX, offsetY, offsetZ]);
}

export function useMoldGenerator() {

  /**
   * Generate a two-part mold using CSG boolean operations
   */
  const generateMold = useCallback(async (
    geometry: THREE.BufferGeometry,
    boundingBox: THREE.Box3,
    axis: Axis,
    offset: number, // 0-1 normalized
  ): Promise<{ top: THREE.BufferGeometry; bottom: THREE.BufferGeometry }> => {
    const wasm = await getManifold();
    const { Manifold } = wasm;

    // Compute actual split position
    const bboxSize = new THREE.Vector3();
    const bboxMin = boundingBox.min.clone();
    const bboxMax = boundingBox.max.clone();
    boundingBox.getSize(bboxSize);

    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const splitPos = bboxMin.getComponent(axisIdx) +
      (bboxMax.getComponent(axisIdx) - bboxMin.getComponent(axisIdx)) * offset;

    // Wall thickness and clearance
    const wallThickness = Math.max(bboxSize.x, bboxSize.y, bboxSize.z) * 0.08;
    const clearance = wallThickness * 0.05;

    // Mold outer box dimensions
    const moldSize = new THREE.Vector3(
      bboxSize.x + wallThickness * 2,
      bboxSize.y + wallThickness * 2,
      bboxSize.z + wallThickness * 2,
    );

    const moldMin = new THREE.Vector3(
      bboxMin.x - wallThickness,
      bboxMin.y - wallThickness,
      bboxMin.z - wallThickness,
    );

    // Convert the model to a Manifold
    let modelManifold;
    try {
      modelManifold = geometryToManifold(wasm, geometry);
    } catch (e) {
      console.error('Failed to create manifold from geometry:', e);
      throw new Error('Could not convert geometry to manifold. The model may not be watertight.');
    }

    // Create the full mold box
    const fullBox = createBox(wasm,
      moldSize.x, moldSize.y, moldSize.z,
      moldMin.x, moldMin.y, moldMin.z
    );

    // Subtract the model from the box to get the mold cavity
    const moldCavity = fullBox.subtract(modelManifold);

    // Now split the cavity into top and bottom halves using cutting planes
    // Create top half cutting box
    let topCutSize: [number, number, number];
    let topCutOffset: [number, number, number];
    let bottomCutSize: [number, number, number];
    let bottomCutOffset: [number, number, number];

    const bigExtent = Math.max(moldSize.x, moldSize.y, moldSize.z) * 2;

    switch (axis) {
      case 'x':
        topCutSize = [moldMin.x + moldSize.x - splitPos + 0.01, bigExtent, bigExtent];
        topCutOffset = [splitPos, moldMin.y - bigExtent / 4, moldMin.z - bigExtent / 4];
        bottomCutSize = [splitPos - moldMin.x + 0.01, bigExtent, bigExtent];
        bottomCutOffset = [moldMin.x, moldMin.y - bigExtent / 4, moldMin.z - bigExtent / 4];
        break;
      case 'y':
        topCutSize = [bigExtent, moldMin.y + moldSize.y - splitPos + 0.01, bigExtent];
        topCutOffset = [moldMin.x - bigExtent / 4, splitPos, moldMin.z - bigExtent / 4];
        bottomCutSize = [bigExtent, splitPos - moldMin.y + 0.01, bigExtent];
        bottomCutOffset = [moldMin.x - bigExtent / 4, moldMin.y, moldMin.z - bigExtent / 4];
        break;
      case 'z':
      default:
        topCutSize = [bigExtent, bigExtent, moldMin.z + moldSize.z - splitPos + 0.01];
        topCutOffset = [moldMin.x - bigExtent / 4, moldMin.y - bigExtent / 4, splitPos];
        bottomCutSize = [bigExtent, bigExtent, splitPos - moldMin.z + 0.01];
        bottomCutOffset = [moldMin.x - bigExtent / 4, moldMin.y - bigExtent / 4, moldMin.z];
        break;
    }

    const topCutter = createBox(wasm, ...topCutSize, ...topCutOffset);
    const bottomCutter = createBox(wasm, ...bottomCutSize, ...bottomCutOffset);

    // Intersect to get each half
    const topHalf = moldCavity.intersect(topCutter);
    const bottomHalf = moldCavity.intersect(bottomCutter);

    // Add registration pins/keys to help alignment
    const pinRadius = wallThickness * 0.3;
    const pinHeight = wallThickness * 0.6;
    const pinPositions = getRegistrationPinPositions(boundingBox, axis, splitPos, wallThickness);

    let topResult = topHalf;
    let bottomResult = bottomHalf;

    for (const pinPos of pinPositions) {
      const pin = Manifold.cylinder(pinHeight, pinRadius, pinRadius, 16)
        .rotate(getRotationForAxis(axis))
        .translate(pinPos);

      // Add pin to one half, subtract from the other
      topResult = topResult.add(pin);
      bottomResult = bottomResult.subtract(
        Manifold.cylinder(pinHeight + clearance * 2, pinRadius + clearance, pinRadius + clearance, 16)
          .rotate(getRotationForAxis(axis))
          .translate(pinPos)
      );
    }

    // ── Pour sprue, runner, gate, and vent system ──
    //
    // Engineering principles (from injection molding & casting best practices):
    //
    // SPRUE: Tapered funnel from outer surface into the mold. Taper ratio of
    //   ~0.008 cm/cm length. Gate diameter should be ~1.5x the thickest wall
    //   section. We use a conservative taper since these are cast (not injected).
    //
    // GATE: Where the sprue meets the cavity. Placed at the thickest section
    //   of the part so material flows from thick→thin (reduces shrinkage voids).
    //   For gravity casting, placed high so material flows down.
    //
    // VENTS: Placed at the highest points and extremities of the cavity —
    //   wherever air would get trapped last as material fills from the gate.
    //   For a two-part mold, vents go at the points farthest from the gate
    //   AND at any local high points. More vents = better fill, fewer voids.
    //
    // SIZING: Sprue gate ~1.5x estimated wall thickness. Vents much smaller
    //   (just enough for air, not material leakage). Sprue tapers wider at top.

    const estWallThickness = Math.min(bboxSize.x, bboxSize.y, bboxSize.z) * 0.15;
    const sprueGateRadius = Math.max(estWallThickness * 0.75, wallThickness * 0.25);
    const sprueTopRadius = sprueGateRadius * 2.0;  // funnel widens at pour end
    const ventRadius = sprueGateRadius * 0.35;     // vents much smaller than gate

    const channels = computeChannelPositions(
      boundingBox, axis, splitPos, moldMin, moldSize, wallThickness, geometry
    );

    // Sprue: tapered cylinder — wider at pour end, narrower at cavity
    const sprue = Manifold.cylinder(
      channels.sprueHeight,
      sprueGateRadius,    // cavity end (narrower)
      sprueTopRadius,     // pour end (wider funnel)
      24
    ).rotate(channels.rotation).translate(channels.spruePos);

    topResult = topResult.subtract(sprue);

    // Vent holes at extremities and high points
    for (const ventPos of channels.ventPositions) {
      const vent = Manifold.cylinder(
        channels.sprueHeight,
        ventRadius,
        ventRadius * 1.2,  // slight taper for easier demolding
        12
      ).rotate(channels.rotation).translate(ventPos);

      topResult = topResult.subtract(vent);
    }

    const topGeo = manifoldToGeometry(topResult);
    const bottomGeo = manifoldToGeometry(bottomResult);

    return { top: topGeo, bottom: bottomGeo };
  }, []);

  /**
   * Auto-detect the best parting plane by analyzing the geometry
   * Tests multiple axis/offset combos and picks the one with the most balanced split
   */
  const autoDetectPlane = useCallback(async (
    geometry: THREE.BufferGeometry
  ): Promise<{ axis: Axis; offset: number }> => {
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!;
    const bboxSize = new THREE.Vector3();
    bbox.getSize(bboxSize);

    const positions = geometry.attributes.position.array;
    const vertCount = positions.length / 3;

    let bestAxis: Axis = 'z';
    let bestOffset = 0.5;
    let bestScore = -Infinity;

    const axes: Axis[] = ['x', 'y', 'z'];
    const steps = 20;

    for (const axis of axes) {
      const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      const min = bbox.min.getComponent(axisIdx);
      const max = bbox.max.getComponent(axisIdx);
      const range = max - min;

      for (let s = 1; s < steps; s++) {
        const offset = s / steps;
        const splitVal = min + range * offset;

        // Count vertices above and below
        let above = 0;
        let below = 0;
        for (let i = 0; i < vertCount; i++) {
          const v = positions[i * 3 + axisIdx];
          if (v >= splitVal) above++;
          else below++;
        }

        // Score: balance (50/50 split is ideal) + prefer Z axis (gravity)
        const total = above + below;
        const balance = 1 - Math.abs(above - below) / total;

        // Penalize extreme positions
        const centeredness = 1 - Math.abs(offset - 0.5) * 2;

        // Slight preference for Z axis (conventional mold orientation)
        const axisPref = axis === 'z' ? 0.05 : 0;

        // Prefer the axis with the largest extent (more room for the mold)
        const extentNorm = range / Math.max(bboxSize.x, bboxSize.y, bboxSize.z);

        const score = balance * 0.6 + centeredness * 0.2 + axisPref + extentNorm * 0.15;

        if (score > bestScore) {
          bestScore = score;
          bestAxis = axis;
          bestOffset = offset;
        }
      }
    }

    return { axis: bestAxis, offset: bestOffset };
  }, []);

  /**
   * Export mold halves to various formats
   */
  const exportFiles = useCallback(async (
    topGeo: THREE.BufferGeometry,
    bottomGeo: THREE.BufferGeometry,
    fileName: string,
    format: 'stl' | 'obj' | '3mf',
  ) => {
    const baseName = fileName.replace(/\.[^.]+$/, '');

    const exportGeometry = async (geo: THREE.BufferGeometry, suffix: string) => {
      let data: ArrayBuffer;

      switch (format) {
        case 'stl':
          data = exportSTL(geo);
          break;
        case 'obj':
          data = exportOBJ(geo);
          break;
        case '3mf':
          data = await export3MF(geo);
          break;
        default:
          data = exportSTL(geo);
      }

      // Save file
      const blob = new Blob([data], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_${suffix}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    };

    await exportGeometry(topGeo, 'top');
    // Browsers block rapid successive downloads — small delay between them
    await new Promise(resolve => setTimeout(resolve, 500));
    await exportGeometry(bottomGeo, 'bottom');
  }, []);

  return { generateMold, exportFiles, autoDetectPlane };
}

/**
 * Export to binary STL
 */
function exportSTL(geometry: THREE.BufferGeometry): ArrayBuffer {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = geo.attributes.position.array;
  const normals = geo.attributes.normal?.array;
  const triangleCount = positions.length / 9;

  const bufferLength = 84 + triangleCount * 50;
  const buffer = new ArrayBuffer(bufferLength);
  const view = new DataView(buffer);

  // Header (80 bytes)
  for (let i = 0; i < 80; i++) view.setUint8(i, 0);

  // Triangle count
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const idx = i * 9;

    // Normal (compute from vertices if not available)
    if (normals) {
      view.setFloat32(offset, normals[idx], true);
      view.setFloat32(offset + 4, normals[idx + 1], true);
      view.setFloat32(offset + 8, normals[idx + 2], true);
    } else {
      view.setFloat32(offset, 0, true);
      view.setFloat32(offset + 4, 0, true);
      view.setFloat32(offset + 8, 1, true);
    }
    offset += 12;

    // 3 vertices
    for (let v = 0; v < 3; v++) {
      const vi = idx + v * 3;
      view.setFloat32(offset, positions[vi], true);
      view.setFloat32(offset + 4, positions[vi + 1], true);
      view.setFloat32(offset + 8, positions[vi + 2], true);
      offset += 12;
    }

    // Attribute byte count
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Export to OBJ format
 */
function exportOBJ(geometry: THREE.BufferGeometry): ArrayBuffer {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = geo.attributes.position.array;
  const vertCount = positions.length / 3;

  const lines: string[] = ['# Mold Maker Export'];

  // Vertices
  for (let i = 0; i < vertCount; i++) {
    lines.push(`v ${positions[i * 3]} ${positions[i * 3 + 1]} ${positions[i * 3 + 2]}`);
  }

  // Faces (1-indexed)
  for (let i = 0; i < vertCount; i += 3) {
    lines.push(`f ${i + 1} ${i + 2} ${i + 3}`);
  }

  return new TextEncoder().encode(lines.join('\n') + '\n').buffer;
}

/**
 * Export to 3MF format (simplified — single mesh in a ZIP container)
 */
async function export3MF(geometry: THREE.BufferGeometry): Promise<ArrayBuffer> {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = geo.attributes.position.array;
  const vertCount = positions.length / 3;

  // Build vertices XML
  let verticesXml = '';
  for (let i = 0; i < vertCount; i++) {
    verticesXml += `          <vertex x="${positions[i * 3]}" y="${positions[i * 3 + 1]}" z="${positions[i * 3 + 2]}" />\n`;
  }

  // Build triangles XML
  let trianglesXml = '';
  for (let i = 0; i < vertCount; i += 3) {
    trianglesXml += `          <triangle v1="${i}" v2="${i + 1}" v3="${i + 2}" />\n`;
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${verticesXml}        </vertices>
        <triangles>
${trianglesXml}        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  // Use JSZip-like approach with minimal ZIP creation
  const { createZip } = await import('../utils/minizip');
  return createZip({
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rels,
    '3D/3dmodel.model': modelXml,
  });
}

function getRegistrationPinPositions(
  bbox: THREE.Box3, axis: Axis, splitPos: number, wallThickness: number
): [number, number, number][] {
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bbox.getCenter(center);
  bbox.getSize(size);

  const inset = wallThickness * 0.7;
  const positions: [number, number, number][] = [];

  switch (axis) {
    case 'z':
      positions.push(
        [bbox.min.x - inset, bbox.min.y - inset, splitPos],
        [bbox.max.x + inset, bbox.min.y - inset, splitPos],
        [bbox.min.x - inset, bbox.max.y + inset, splitPos],
        [bbox.max.x + inset, bbox.max.y + inset, splitPos],
      );
      break;
    case 'y':
      positions.push(
        [bbox.min.x - inset, splitPos, bbox.min.z - inset],
        [bbox.max.x + inset, splitPos, bbox.min.z - inset],
        [bbox.min.x - inset, splitPos, bbox.max.z + inset],
        [bbox.max.x + inset, splitPos, bbox.max.z + inset],
      );
      break;
    case 'x':
      positions.push(
        [splitPos, bbox.min.y - inset, bbox.min.z - inset],
        [splitPos, bbox.max.y + inset, bbox.min.z - inset],
        [splitPos, bbox.min.y - inset, bbox.max.z + inset],
        [splitPos, bbox.max.y + inset, bbox.max.z + inset],
      );
      break;
  }

  return positions;
}

function getRotationForAxis(axis: Axis): [number, number, number] {
  switch (axis) {
    case 'x': return [0, 90, 0];
    case 'y': return [90, 0, 0];
    case 'z': return [0, 0, 0];
  }
}

/**
 * Compute sprue and vent positions using geometry analysis.
 *
 * Strategy:
 * - SPRUE: Analyze the part geometry to find the thickest cross-section in the
 *   "top" half (positive side of split). Gate at the thickest point ensures
 *   material flows thick→thin, reducing shrinkage voids. For gravity casting,
 *   placing the gate high lets gravity assist the fill.
 *
 * - VENTS: Find the extremity vertices in the top half that are farthest from
 *   the sprue. These are where air gets trapped last. Also add vents at any
 *   local high points (vertices with high values along the split axis).
 *   More vents at extremities = better fill with fewer air pockets.
 *
 * Manifold.cylinder() creates along Z by default, so we return a rotation
 * to orient the holes along the correct axis.
 */
function computeChannelPositions(
  bbox: THREE.Box3,
  axis: Axis,
  splitPos: number,
  moldMin: THREE.Vector3,
  moldSize: THREE.Vector3,
  wallThickness: number,
  geometry: THREE.BufferGeometry,
): {
  spruePos: [number, number, number];
  sprueHeight: number;
  ventPositions: [number, number, number][];
  rotation: [number, number, number];
} {
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const bboxSize = new THREE.Vector3();
  bbox.getSize(bboxSize);

  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const topFaceVal = moldMin.getComponent(axisIdx) + moldSize.getComponent(axisIdx);
  const sprueHeight = topFaceVal - splitPos;

  const positions = geometry.attributes.position.array;
  const vertCount = positions.length / 3;

  // ── Find optimal sprue position ──
  // Sample the geometry to find the "thickest" region in the top half.
  // We estimate local thickness by looking at vertex density — areas with
  // many vertices close together in the non-split axes are likely thicker.
  // As a practical heuristic: find the centroid of all vertices in the top half.
  // This naturally gravitates toward the bulk of the part.
  let sumA = 0, sumB = 0, topCount = 0;

  // The two "lateral" axes (not the split axis)
  const lateralA = (axisIdx + 1) % 3;
  const lateralB = (axisIdx + 2) % 3;

  for (let i = 0; i < vertCount; i++) {
    const splitVal = positions[i * 3 + axisIdx];
    if (splitVal >= splitPos) {
      sumA += positions[i * 3 + lateralA];
      sumB += positions[i * 3 + lateralB];
      topCount++;
    }
  }

  // Centroid of top-half vertices → sprue placement
  const centroidA = topCount > 0 ? sumA / topCount : center.getComponent(lateralA);
  const centroidB = topCount > 0 ? sumB / topCount : center.getComponent(lateralB);

  let spruePos: [number, number, number] = [0, 0, 0];
  spruePos[axisIdx] = splitPos;
  spruePos[lateralA] = centroidA;
  spruePos[lateralB] = centroidB;

  // ── Find optimal vent positions ──
  // Vents go at the extremities farthest from the sprue, AND at local high
  // points where air would collect. We find the vertices in the top half
  // that are farthest from the sprue in the lateral plane.
  // Sample every Nth vertex to cap the candidate array size.
  // For large meshes (100k+ verts), sorting all candidates is wasteful
  // since we only need the ~top-4 farthest points.
  const maxCandidates = 2000;
  const sampleStep = Math.max(1, Math.floor(vertCount / maxCandidates));
  const ventCandidates: { dist: number; a: number; b: number }[] = [];

  for (let i = 0; i < vertCount; i += sampleStep) {
    const splitVal = positions[i * 3 + axisIdx];
    if (splitVal >= splitPos) {
      const a = positions[i * 3 + lateralA];
      const b = positions[i * 3 + lateralB];
      const dist = Math.sqrt((a - centroidA) ** 2 + (b - centroidB) ** 2);
      ventCandidates.push({ dist, a, b });
    }
  }

  // Sort by distance from sprue, take the farthest points
  ventCandidates.sort((x, y) => y.dist - x.dist);

  // Cluster the farthest points into distinct vent locations
  // (we don't want 5 vents next to each other — spread them out)
  const ventPositions: [number, number, number][] = [];
  const minVentSpacing = Math.max(bboxSize.getComponent(lateralA), bboxSize.getComponent(lateralB)) * 0.3;

  for (const candidate of ventCandidates) {
    if (ventPositions.length >= 4) break; // max 4 vents

    const tooClose = ventPositions.some(vp => {
      const da = vp[lateralA] - candidate.a;
      const db = vp[lateralB] - candidate.b;
      return Math.sqrt(da * da + db * db) < minVentSpacing;
    });

    if (!tooClose) {
      const pos: [number, number, number] = [0, 0, 0];
      pos[axisIdx] = splitPos;
      pos[lateralA] = candidate.a;
      pos[lateralB] = candidate.b;
      ventPositions.push(pos);
    }
  }

  // Ensure at least 2 vents: if clustering eliminated too many, add corners
  if (ventPositions.length < 2) {
    const corners: [number, number][] = [
      [bbox.min.getComponent(lateralA), bbox.min.getComponent(lateralB)],
      [bbox.max.getComponent(lateralA), bbox.max.getComponent(lateralB)],
      [bbox.min.getComponent(lateralA), bbox.max.getComponent(lateralB)],
      [bbox.max.getComponent(lateralA), bbox.min.getComponent(lateralB)],
    ];
    for (const [ca, cb] of corners) {
      if (ventPositions.length >= 2) break;
      const pos: [number, number, number] = [0, 0, 0];
      pos[axisIdx] = splitPos;
      pos[lateralA] = ca;
      pos[lateralB] = cb;
      ventPositions.push(pos);
    }
  }

  // Rotation to orient cylinders along the split axis
  let rotation: [number, number, number];
  switch (axis) {
    case 'z': rotation = [0, 0, 0]; break;
    case 'y': rotation = [90, 0, 0]; break;
    case 'x': rotation = [0, 90, 0]; break;
  }

  console.log(`Sprue at [${spruePos.map(v => v.toFixed(1))}], ${ventPositions.length} vents, height ${sprueHeight.toFixed(1)}`);

  return { spruePos, sprueHeight, ventPositions, rotation };
}
