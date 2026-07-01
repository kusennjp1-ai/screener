import { defineConfig } from '@playwright/test';

const ci = Boolean(globalThis.process?.env?.CI);

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: ci ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure',
    // Allow pointing at a pre-installed browser when the pinned Playwright
    // build's auto-download isn't available (e.g. sandboxed CI images).
    ...(globalThis.process?.env?.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: globalThis.process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
