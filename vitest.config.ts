import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Use happy-dom for BufferGeometry tests — it's lighter than jsdom and
    // Three.js only touches a handful of DOM APIs (document, TextEncoder, etc.)
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // CSG generation and WASM bridges are integration-y; skip from coverage
      // math until we add worker-level integration tests.
      exclude: [
        'src/main/**',
        'src/renderer/mold/manifoldBridge.ts',
        'src/renderer/mold/generateMold.ts',
        '**/*.config.ts',
        '**/node_modules/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
