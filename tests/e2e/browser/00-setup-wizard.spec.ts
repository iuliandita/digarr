import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'

test.describe('Setup Wizard', () => {
  test('loads and shows mode selection', async ({ page }) => {
    const token = await ensureAdminToken(page.request)
    expect(token).toBeTruthy()
    if (!token) return
    await installAuthToken(page, token)
    await page.goto('/')

    const discoverButton = page.getByRole('button', { name: /discover/i })
    const lidarrButton = page.getByRole('button', { name: /lidarr/i })
    await expect(discoverButton).toBeVisible({ timeout: 10_000 })
    await expect(lidarrButton).toBeVisible({ timeout: 10_000 })

    await discoverButton.click()
    await expect(page.getByText(/AI Provider/i)).toBeVisible({ timeout: 10_000 })
  })
})
