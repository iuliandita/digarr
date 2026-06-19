import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'
import { seedRecommendations } from './seed'

test.describe('Pipeline Progress', () => {
  test('shows progress when scan is triggered', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await seedRecommendations(page.request, token)
    await installAuthToken(page, token)

    await page.goto('/')

    const scanButton = page.getByRole('button', { name: /run scan/i }).first()
    await expect(scanButton).toBeVisible({ timeout: 10_000 })
    await scanButton.click()

    // The progress surface shows an elapsed-time readout ("Running for Ns")
    // and a stage label as soon as the pipeline starts streaming.
    await expect(page.getByText(/running for|running your first scan/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
