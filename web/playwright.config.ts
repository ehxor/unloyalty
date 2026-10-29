import { defineConfig, devices } from '@playwright/test';
import { CAMERA_VIDEO } from './test/e2e/camera';

const PORT = 4174;

export default defineConfig({
  testDir: 'test/e2e',
  globalSetup: './test/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Phone-sized; the app is mobile-first.
    ...devices['Pixel 7'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // Full Chromium rather than headless-shell: the shell has no video capture, even fake.
        channel: 'chromium',
        // A fake camera playing a barcode video; tests opt in to camera permission.
        launchOptions: { args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${CAMERA_VIDEO}`] },
      },
    },
  ],
  webServer: {
    // The real server binary with the production build embedded: same CSP, caching and SPA fallback as deployed.
    // Fresh database per run; open registration so each test makes its own account; trusted X-Forwarded-For so
    // every simulated device has its own login rate limit.
    command: `make -C .. server && DATA_DIR="$(mktemp -d)" PORT=${PORT} ALLOW_REGISTRATION=true TRUST_PROXY_HEADERS=true ../bin/wallet serve`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
