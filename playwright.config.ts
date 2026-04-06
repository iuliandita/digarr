import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e/browser',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'bun run dev',
      port: 3000,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'bun run dev:web',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
