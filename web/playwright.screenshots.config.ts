import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** `pnpm screenshots` (or `make screenshots`): regenerates docs/screenshots/*.png for the README. */
export default defineConfig({
  ...base,
  testDir: 'scripts',
  testMatch: 'screenshots.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
});
