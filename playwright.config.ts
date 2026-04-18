import { defineConfig } from '@playwright/test'

const webServer =
  process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1'
    ? undefined
    : [
        {
          command: 'bun run tests/e2e/browser/start-backend.ts',
          port: 3000,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: 'bun run dev:web',
          port: 5173,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      ]

export default defineConfig({
  testDir: 'tests/e2e/browser',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer,
})
