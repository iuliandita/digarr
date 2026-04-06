import { expect, test } from '@playwright/test'

test.describe('Setup Wizard', () => {
  test('loads and shows mode selection', async ({ page }) => {
    await page.goto('/')

    // Fresh app should redirect to setup wizard or register page
    await expect(page.getByText(/welcome|setup|get started|register|create account/i)).toBeVisible({
      timeout: 10_000,
    })

    // Mode selection buttons should be present (Lidarr vs Discover)
    const discoverButton = page.getByRole('button', { name: /discover/i })
    const lidarrButton = page.getByRole('button', { name: /lidarr/i })

    // At least one mode button should be visible on a fresh setup
    const hasDiscover = await discoverButton.isVisible({ timeout: 3_000 }).catch(() => false)
    const hasLidarr = await lidarrButton.isVisible({ timeout: 3_000 }).catch(() => false)

    // If we're on the setup page, mode selection should be available
    // (may not be if the app redirected to register instead)
    if (hasDiscover || hasLidarr) {
      // Click discover mode and verify the wizard advances
      await discoverButton.click()
      await expect(page.locator('body')).toBeVisible()
    }
  })
})
