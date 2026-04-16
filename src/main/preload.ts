import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — runs in an isolated context with access to a limited
 * Node API, and is the ONLY bridge between the sandboxed renderer and
 * the main process.
 *
 * Rules of thumb for anything added here:
 *   1. Expose specific functions, never `ipcRenderer` itself. A caller
 *      that can invoke arbitrary channels can effectively bypass us.
 *   2. Keep argument shapes primitive (string, ArrayBuffer, plain JSON).
 *      Functions/prototypes don't survive the contextBridge clone.
 *   3. Every `invoke(channel, ...)` here must have a matching
 *      `ipcMain.handle(channel, ...)` in electron.ts — otherwise the
 *      call silently hangs on a rejected Promise.
 */

export interface ElectronAPI {
  /** Opens a native file picker filtered to .stl/.obj and returns the file bytes. */
  openFile: () => Promise<{ path: string; name: string; buffer: ArrayBuffer } | null>;

  /** Shows a native save dialog and returns the chosen path (or null if cancelled). */
  saveFile: (defaultName: string, filters: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;

  /** Writes raw bytes to a previously chosen path. */
  writeFile: (filePath: string, data: ArrayBuffer) => Promise<boolean>;
}

const api: ElectronAPI = {
  openFile: () => ipcRenderer.invoke('open-file-dialog'),
  saveFile: (defaultName, filters) =>
    ipcRenderer.invoke('save-file-dialog', defaultName, filters),
  writeFile: (filePath, data) =>
    ipcRenderer.invoke('write-file', filePath, data),
};

contextBridge.exposeInMainWorld('electronAPI', api);
