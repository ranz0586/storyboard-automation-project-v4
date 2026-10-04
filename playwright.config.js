import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3107', trace: 'retain-on-failure' },
  webServer: [{
    command: 'node tests/ui/server.mjs',
    url: 'http://127.0.0.1:3107/health',
    reuseExistingServer: false,
    timeout: 30_000,
  }, {
    command: 'node node_modules/vite/bin/vite.js --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175/',
    env: { UI_API_TARGET: 'http://127.0.0.1:3107' },
    reuseExistingServer: false,
    timeout: 30_000,
  }],
});
