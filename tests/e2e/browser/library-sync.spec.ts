import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'

test.describe('library sync', () => {
  test('library sources panel renders and Sync all triggers the API request', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    test.skip(!token, 'Requires a working local Postgres test database')
    if (!token) return

    await installAuthToken(page, token)

    await page.goto('/library/health')
    await expect(page.getByRole('heading', { name: 'Library Sources' })).toBeVisible()

    const syncRequest = page.waitForRequest(
      (req) => req.url().includes('/api/v1/library/sync') && req.method() === 'POST',
    )
    await page.getByRole('button', { name: /sync all/i }).click()
    await syncRequest
  })
})
