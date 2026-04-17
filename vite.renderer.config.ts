import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * CSP connect-src hardening for telemetry.
 *
 * At build time we read VITE_TELEMETRY_HOST from the environment and inject it
 * into index.html's CSP meta tag, replacing the `%TELEMETRY_CONNECT_SRC%`
 * placeholder. If the var is unset, the placeholder is replaced with an empty
 * string — which means the CSP's connect-src remains `'self' blob:` and the
 * browser itself will block any attempted analytics POST.
 *
 * Why this matters: the app-level opt-in toggle is enforcement at one layer;
 * CSP is enforcement at a second, independent layer. An attacker who
 * compromises one of our npm deps cannot add a "send to evil.com" call because
 * evil.com isn't in connect-src. Even `'self' blob:` is the smallest
 * connect-src that still allows the app to load WASM + worker scripts.
 *
 * We DELIBERATELY do not support wildcards. A misconfigured build (e.g.
 * `VITE_TELEMETRY_HOST=https:`) should fail loudly, not silently widen the
 * CSP. The validation below throws at build time if the value looks wrong.
 */
function telemetryCspPlugin(host: string): Plugin {
  // Accept only a scheme+host. No paths, no wildcards, no commas. If the
  // value doesn't look like a CSP source (https://example.com), refuse to
  // build. Allow http:// for localhost / dev telemetry endpoints; reject
  // anything with a path, query, or non-numeric port.
  if (host) {
    const ok = /^https?:\/\/[A-Za-z0-9.\-]+(:\d+)?$/.test(host);
    if (!ok) {
      throw new Error(
        `[telemetry CSP] VITE_TELEMETRY_HOST must be a scheme+host with no path ` +
          `(e.g. "https://umami.example.com"). Received: ${JSON.stringify(host)}`,
      );
    }
  }
  return {
    name: 'telemetry-csp',
    transformIndexHtml(html) {
      return html.replace(/%TELEMETRY_CONNECT_SRC%/g, host);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite's loadEnv reads .env, .env.local, .env.[mode] — anything prefixed
  // with VITE_ is exposed to the client. We also fall back to raw process.env
  // so CI can inject the variable without a dotenv file.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const telemetryHost = env.VITE_TELEMETRY_HOST || process.env.VITE_TELEMETRY_HOST || '';

  return {
    plugins: [react(), telemetryCspPlugin(telemetryHost)],
    root: '.',
    base: './',
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
      },
    },
    optimizeDeps: {
      exclude: ['manifold-3d'],
    },
    server: {
      port: 5173,
    },
  };
});
