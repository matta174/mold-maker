import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Parses a raw model file buffer into a Three.js BufferGeometry.
 *
 * Shared by the Electron IPC path (where the main process hands us an
 * ArrayBuffer via `open-file-dialog`) and the browser file-input fallback,
 * so the "which loader do we use?" logic lives in exactly one place.
 *
 * Throws a user-facing Error on unsupported extensions or loader failures;
 * callers are expected to surface `err.message` to the UI.
 */
export function parseModel(
  arrayBuffer: ArrayBuffer,
  fileName: string,
): { geometry: THREE.BufferGeometry; fileName: string } {
  const ext = fileName.toLowerCase().split('.').pop();

  try {
    if (ext === 'stl') {
      const loader = new STLLoader();
      const geometry = loader.parse(arrayBuffer);
      return { geometry, fileName };
    }

    if (ext === 'obj') {
      const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));
      const loader = new OBJLoader();
      const obj = loader.parse(text);
      const geometry = mergeObjGeometries(obj);
      return { geometry, fileName };
    }

    throw new Error(`Unsupported file type: .${ext ?? '(none)'} — expected .stl or .obj`);
  } catch (err) {
    // Re-throw with a user-facing message. STLLoader/OBJLoader can throw on
    // truncated or malformed files; surfacing the raw error ("Cannot read
    // properties of undefined...") is useless to the user, so we wrap it.
    if (err instanceof Error && err.message.startsWith('Unsupported file type')) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${fileName}: ${detail}`);
  }
}

/**
 * Parse an already-in-hand File (from <input type=file> or a drag-drop
 * DataTransfer). Shared by the file-input fallback inside loadFile() and
 * by the drag-drop handler in App.tsx so both entry points produce the
 * same normalized `{ geometry, fileName }` shape.
 */
export async function parseFile(
  file: File,
): Promise<{ geometry: THREE.BufferGeometry; fileName: string }> {
  const arrayBuffer = await file.arrayBuffer();
  return parseModel(arrayBuffer, file.name);
}

export async function loadFile(): Promise<{ geometry: THREE.BufferGeometry; fileName: string } | null> {
  // Detect the hardened Electron bridge exposed by preload.ts. With
  // contextIsolation:true + nodeIntegration:false, `window.require` is
  // gone — `window.electronAPI` is the only way through. Types for this
  // global come from renderer/electron.d.ts.
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;

  if (electronAPI) {
    const result = await electronAPI.openFile();
    if (!result) return null;

    const { name, buffer } = result;
    return parseModel(buffer, name);
  }

  // Browser fallback: use file input
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl,.obj';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }

      try {
        resolve(await parseFile(file));
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}

function mergeObjGeometries(obj: THREE.Group): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry.clone();
      if (child.matrixWorld) {
        geo.applyMatrix4(child.matrixWorld);
      }
      // Ensure we have an indexed or non-indexed geometry with position
      if (geo.attributes.position) {
        geometries.push(geo);
      }
    }
  });

  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  if (geometries.length === 1) {
    return geometries[0];
  }

  return mergeGeometries(geometries, false) || geometries[0];
}
