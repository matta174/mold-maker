import { defineConfig } from 'vite';

/**
 * Vite config for the preload script.
 *
 * The preload runs in a partially-privileged context (can import `electron`,
 * has contextBridge access) but is bundled into a single file that lives
 * next to main.js under .vite/build/. Keep this narrow: everything exposed
 * here shows up on `window.electronAPI` in the renderer.
 */
export default defineConfig({});
