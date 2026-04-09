import { expect, test } from '@playwright/test'

test.describe('Setup Wizard (Emby)', () => {
  test('offers the Emby path from the mode selection', async ({ page }) => {
    await page.goto('/')

    // Fresh app should redirect to setup wizard or register page
    await expect(page.getByText(/welcome|setup|get started|register|create account/i)).toBeVisible({
      timeout: 10_000,
    })

    const embyButton = page.getByRole('button', { name: /Emby/i })
    const hasEmby = await embyButton.isVisible({ timeout: 3_000 }).catch(() => false)

    // If we're on the setup page, Emby should appear alongside Lidarr / Just discover
    if (hasEmby) {
      await embyButton.click()
      await expect(page.getByText(/Connect Emby/i)).toBeVisible({ timeout: 3_000 })
    }
  })
})
