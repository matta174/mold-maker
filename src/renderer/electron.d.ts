/**
 * Ambient type declarations for the `window.electronAPI` bridge exposed
 * by src/main/preload.ts via contextBridge.exposeInMainWorld.
 *
 * Keeping this in the renderer folder avoids pulling `electron` types
 * into renderer type-checking (which would fail — electron is a Node
 * module and the renderer can't import it under contextIsolation).
 *
 * If you add a method in preload.ts, mirror it here.
 */

export interface ElectronAPI {
  openFile: () => Promise<{ path: string; name: string; buffer: ArrayBuffer } | null>;
  saveFile: (
    defaultName: string,
    filters: Array<{ name: string; extensions: string[] }>,
  ) => Promise<string | null>;
  writeFile: (filePath: string, data: ArrayBuffer) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
