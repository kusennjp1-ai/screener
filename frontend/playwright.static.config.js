import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/static', timeout: 60000, workers: 1,
  expect: { timeout: 20000 },
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    env: { VITE_STATIC_SITE: 'true', VITE_BASE_PATH: '/' },
    url: 'http://127.0.0.1:4174', timeout: 120000,
  },
});
