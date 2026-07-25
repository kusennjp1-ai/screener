import { defineConfig } from '@playwright/test';

const ci = Boolean(globalThis.process?.env?.CI);

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 60_000,
  expect: {
    // A cold Vite dev server transforms modules on first request, so the very
    // first mount in CI can legitimately take longer than a warm local run.
    timeout: ci ? 30_000 : 10_000,
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
    // Wait for a real HTTP response, not just an open socket. `port` is
    // satisfied the moment Vite binds, which is BEFORE it has pre-bundled and
    // transformed the app — tests then start against a server that answers TCP
    // but renders nothing, and every "did the page load" assertion times out.
    // Requesting the URL both proves readiness and pays the cold-start cost
    // once, up front, instead of inside the first test's timeout.
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
