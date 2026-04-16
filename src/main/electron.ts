import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Mold Maker',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      // Locked down: renderer has no Node access. All privileged work
      // (file I/O, dialogs) goes through preload.ts → ipcMain handlers.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // preload.ts gets compiled to preload.js alongside electron.js.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // MAIN_WINDOW_VITE_DEV_SERVER_URL / MAIN_WINDOW_VITE_NAME are injected as
  // globals by @electron-forge/plugin-vite. In dev the renderer is served by
  // Vite; in production the bundler writes the built renderer into
  // .vite/renderer/<name>/index.html.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC: Open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: '3D Models', extensions: ['stl', 'obj'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return { path: filePath, name: path.basename(filePath), buffer: buffer.buffer };
});

// IPC: Save file dialog
ipcMain.handle('save-file-dialog', async (_event, defaultName: string, filters: any[]) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName,
    filters,
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

// IPC: Write file
ipcMain.handle('write-file', async (_event, filePath: string, data: ArrayBuffer) => {
  fs.writeFileSync(filePath, Buffer.from(data));
  return true;
});
