import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export async function loadFile(): Promise<{ geometry: THREE.BufferGeometry; fileName: string } | null> {
  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && (window as any).require;

  if (isElectron) {
    const { ipcRenderer } = (window as any).require('electron');
    const result = await ipcRenderer.invoke('open-file-dialog');
    if (!result) return null;

    const { name, buffer } = result;
    const ext = name.toLowerCase().split('.').pop();
    const arrayBuffer = buffer;

    if (ext === 'stl') {
      const loader = new STLLoader();
      const geometry = loader.parse(arrayBuffer);
      return { geometry, fileName: name };
    } else if (ext === 'obj') {
      const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));
      const loader = new OBJLoader();
      const obj = loader.parse(text);
      const geometry = mergeObjGeometries(obj);
      return { geometry, fileName: name };
    }
  } else {
    // Browser fallback: use file input
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.stl,.obj';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }

        const arrayBuffer = await file.arrayBuffer();
        const ext = file.name.toLowerCase().split('.').pop();

        if (ext === 'stl') {
          const loader = new STLLoader();
          const geometry = loader.parse(arrayBuffer);
          resolve({ geometry, fileName: file.name });
        } else if (ext === 'obj') {
          const text = new TextDecoder().decode(new Uint8Array(arrayBuffer));
          const loader = new OBJLoader();
          const obj = loader.parse(text);
          const geometry = mergeObjGeometries(obj);
          resolve({ geometry, fileName: file.name });
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  }

  return null;
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
