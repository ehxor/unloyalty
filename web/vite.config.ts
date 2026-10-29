import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function gitSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

const THEME = '#1f6f5c';
const BACKGROUND = '#101413';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version}+${gitSha()}`),
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      // Registration happens from app code (virtual:pwa-register/preact); no injected script, keeps CSP strict.
      injectRegister: false,
      strategies: 'generateSW',
      includeAssets: ['icons/apple-touch-icon-180x180.png', 'icons/favicon.ico', 'icons/icon.svg'],
      manifest: {
        name: 'Unloyalty',
        short_name: 'Unloyalty',
        description: 'Your loyalty, library and membership cards, offline.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME,
        background_color: BACKGROUND,
        icons: [
          { src: '/icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // No runtimeCaching: /api is network-only; card data lives in IndexedDB.
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    // bwip-js encoders dominate the bundle; everything is precached, so one chunk is fine.
    chunkSizeWarningLimit: 700,
  },
  // Device testing before the Go server exists: `tailscale serve` proxies with the *.ts.net Host header.
  preview: {
    allowedHosts: ['.ts.net'],
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/unit/setup.ts'],
  },
});
