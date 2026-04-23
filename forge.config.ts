import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

/**
 * Electron Forge config. Keeps the build pipeline for:
 *   - src/main/electron.ts  → .vite/build/main.js
 *   - src/main/preload.ts   → .vite/build/preload.js
 *   - index.html (renderer) → .vite/renderer/main_window/
 *
 * Only MakerZIP is wired here because that's the only maker currently in
 * devDependencies. To target Windows/Linux installers, add @electron-forge/
 * maker-squirrel / maker-deb / maker-rpm and register them below.
 */
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Electron-packager picks the platform-appropriate extension automatically:
    // icon.icns on macOS, icon.ico on Windows, icon.png on Linux. Provide the
    // base path without extension and it resolves per platform.
    icon: 'assets/logo/icon',
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin', 'linux', 'win32'])],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/electron.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/main/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
