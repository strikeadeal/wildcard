import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 390, height: 844 }
  },
  webServer: [
    {
      // The real backend: a local Worker + Durable Object via wrangler.
      command: 'npx wrangler dev --port 8787 --var GAME_SEED:1337',
      cwd: './worker',
      url: 'http://127.0.0.1:8787/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      command: 'npm run dev -- --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_WS_URL: 'ws://127.0.0.1:8787',
        VITE_GAME_SEED: '1337'
      }
    }
  ]
});
