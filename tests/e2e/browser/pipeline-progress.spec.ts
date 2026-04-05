import { expect, test } from '@playwright/test'

test.describe('Pipeline Progress', () => {
  test('shows progress when scan is triggered', async ({ page }) => {
    await page.goto('/')

    const scanButton = page.getByRole('button', { name: /scan|discover|run/i })
    if (await scanButton.isVisible()) {
      await scanButton.click()

      await expect(
        page.getByText(/collecting|analyzing|discovering|resolving|scoring|filtering|storing/i),
      ).toBeVisible({
        timeout: 5_000,
      })
    }
  })
})
