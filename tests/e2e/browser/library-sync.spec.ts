import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthCookie } from './auth'

test.describe('library sync', () => {
  test('library sources panel renders and Sync all triggers the API request', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return

    await installAuthCookie(page)

    await page.goto('/library?tab=health')
    const sourcesToggle = page.getByRole('button', { name: 'Library Sources' })
    await expect(sourcesToggle).toHaveAttribute('aria-expanded', 'false')
    await sourcesToggle.click()
    await expect(sourcesToggle).toHaveAttribute('aria-expanded', 'true')

    const syncRequest = page.waitForRequest(
      (req) => req.url().includes('/api/v1/library/sync') && req.method() === 'POST',
    )
    await page.getByRole('button', { name: /sync all/i }).click()
    await syncRequest
  })
})
