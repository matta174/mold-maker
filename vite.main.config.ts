import { defineConfig } from 'vite';

/**
 * Vite config for the Electron main process.
 *
 * @electron-forge/plugin-vite injects `build.lib.entry` automatically from
 * the `entry` field in forge.config.ts, so we don't repeat it here. Node
 * built-ins (fs, path, ...) are externalized by the plugin.
 */
export default defineConfig({});
