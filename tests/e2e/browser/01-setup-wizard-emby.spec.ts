import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'

test.describe('Setup Wizard (Emby)', () => {
  test('offers the Emby path from the mode selection', async ({ page }) => {
    const token = await ensureAdminToken(page.request)
    expect(token).toBeTruthy()
    if (!token) return
    await installAuthToken(page, token)
    await page.goto('/')

    const embyButton = page.getByRole('button', { name: /Emby/i })
    await expect(embyButton).toBeVisible({ timeout: 10_000 })
    await embyButton.click()
    await expect(page.getByText(/Connect Emby/i)).toBeVisible({ timeout: 10_000 })
  })
})
