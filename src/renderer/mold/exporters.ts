import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// STL / OBJ / 3MF writers
// ─────────────────────────────────────────────────────────────────────────────
//
// These are pure functions: BufferGeometry → ArrayBuffer. No Manifold/WASM
// dependency, no DOM. That means they're safe to call from a Web Worker and
// easy to unit-test in isolation.
//
// NOTE: STEP export lives in stepExporter.ts because it pulls in a 66 MB
// OpenCascade WASM and breaks the no-WASM invariant above. It is re-exported
// at the bottom of this file so callers have a single entry point for all
// mesh export formats.

/** Export to binary STL. */
export function exportSTL(geometry: THREE.BufferGeometry): ArrayBuffer {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = geo.attributes.position.array;
  const normals = geo.attributes.normal?.array;
  const triangleCount = positions.length / 9;

  const bufferLength = 84 + triangleCount * 50;
  const buffer = new ArrayBuffer(bufferLength);
  const view = new DataView(buffer);

  // Header (80 bytes) — explicitly zero-init (ArrayBuffer does this anyway,
  // but being explicit makes the STL-spec contract obvious to readers).
  for (let i = 0; i < 80; i++) view.setUint8(i, 0);

  // Triangle count (little-endian uint32)
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

/** Export to OBJ format. */
export function exportOBJ(geometry: THREE.BufferGeometry): ArrayBuffer {
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
 * Minimal XML-attribute-safe escape. Exported for tests and for any future
 * string-metadata attributes in the 3MF writer (material names, part labels).
 */
export function xmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Export to 3MF format (simplified — single mesh in a ZIP container). */
export async function export3MF(geometry: THREE.BufferGeometry): Promise<ArrayBuffer> {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = geo.attributes.position.array;
  const vertCount = positions.length / 3;

  // Build vertices XML via array-push + join (O(N), was O(N²) with `+=`)
  const vertexLines: string[] = [];
  for (let i = 0; i < vertCount; i++) {
    vertexLines.push(`          <vertex x="${positions[i * 3]}" y="${positions[i * 3 + 1]}" z="${positions[i * 3 + 2]}" />`);
  }

  // Build triangles XML similarly
  const triangleLines: string[] = [];
  for (let i = 0; i < vertCount; i += 3) {
    triangleLines.push(`          <triangle v1="${i}" v2="${i + 1}" v3="${i + 2}" />`);
  }

  // xmlAttr is wired in to keep the escape path warm even when all inputs are
  // currently numeric. If string metadata is added later, it's escaped by default.
  const unit = xmlAttr('millimeter');

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${vertexLines.join('\n')}
        </vertices>
        <triangles>
${triangleLines.join('\n')}
        </triangles>
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

  const { createZip } = await import('../utils/minizip');
  return createZip({
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rels,
    '3D/3dmodel.model': modelXml,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP re-export
// ─────────────────────────────────────────────────────────────────────────────
//
// Pulls in OpenCascade WASM on first call. Separate file so importing this
// module doesn't transitively load OCP — only callers that actually invoke
// exportSTEP pay the WASM-load cost.

export { exportSTEP, type ExportStepOptions } from './stepExporter';
