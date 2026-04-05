import { expect, test } from '@playwright/test'

test.describe('Setup Wizard', () => {
  test('completes discover-mode setup', async ({ page }) => {
    await page.goto('/')

    // Should redirect to setup wizard
    await expect(page.getByText(/welcome|setup|get started/i)).toBeVisible()

    // Select discover mode
    const discoverButton = page.getByRole('button', { name: /discover/i })
    if (await discoverButton.isVisible()) {
      await discoverButton.click()
    }

    // Fill in username and password
    await page.getByLabel(/username/i).fill('admin')
    await page.getByLabel(/^password/i).fill('testpass123')

    // Submit
    await page.getByRole('button', { name: /complete|finish|submit/i }).click()

    // Should reach dashboard
    await expect(page).toHaveURL('/', { timeout: 10_000 })
  })
})
