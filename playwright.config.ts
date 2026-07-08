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
      command: 'npx peerjs --port 9099',
      url: 'http://localhost:9099/',
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'npm run dev -- --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_PEER_HOST: 'localhost',
        VITE_PEER_PORT: '9099',
        VITE_GAME_SEED: '1337'
      }
    }
  ]
});
