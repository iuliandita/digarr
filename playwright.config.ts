import { defineConfig, devices } from '@playwright/test'

const webServer =
  process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1'
    ? undefined
    : [
        {
          command: 'bun run tests/e2e/browser/start-backend.ts',
          port: 3000,
          reuseExistingServer: false,
          timeout: 30_000,
          // NODE_ENV=test registers the seed route (POST /api/v1/test/seed-recommendations).
          // DIGARR_DISABLE_RATE_LIMIT lifts the per-IP login budget so the many
          // logins across specs in one window don't 429 the later specs.
          env: {
            ...process.env,
            NODE_ENV: 'test',
            DIGARR_DISABLE_RATE_LIMIT: '1',
            ALLOWED_ORIGIN: 'http://localhost:5173',
            PROXY_AUTH_ENABLED: 'true',
            PROXY_AUTH_TRUSTED_PROXIES: '127.0.0.0/8,::1/128',
            DIGARR_DISABLE_REGISTRATION: 'false',
          },
        },
        {
          command: 'bun run dev:web',
          port: 5173,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: 'bun run tests/e2e/browser/start-oidc-mock.ts',
          port: 3011,
          reuseExistingServer: false,
          timeout: 30_000,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            ALLOWED_ORIGIN: 'http://127.0.0.1:3011',
          },
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
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox-auth',
      testMatch: /auth-cookie\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer,
})
