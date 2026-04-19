import { expect, test } from '@playwright/test'

test.describe('Pipeline Progress', () => {
  // Needs an authenticated session with setup complete so the scan control
  // is actually rendered. The old `if (isVisible)` guard let this test
  // silently no-op when the harness loaded the pre-setup screen. Re-enable
  // once the E2E harness seeds setup + authenticates before navigating.
  test.fixme('shows progress when scan is triggered', async ({ page }) => {
    await page.goto('/')

    const scanButton = page.getByRole('button', { name: /scan|discover|run/i })
    await expect(scanButton).toBeVisible()
    await scanButton.click()

    await expect(
      page.getByText(/collecting|analyzing|discovering|resolving|scoring|filtering|storing/i),
    ).toBeVisible({ timeout: 5_000 })
  })
})
