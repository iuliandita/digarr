import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'
import { installDiscoverListView, seedRecommendations } from './seed'

test.describe('Approve/Reject', () => {
  test('approves a recommendation from discover page', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await seedRecommendations(page.request, token)
    await installAuthToken(page, token)
    await installDiscoverListView(page)

    await page.goto('/discover')

    const card = page.locator('[data-testid="rec-card-button"]').first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.hover()

    const approveBtn = card.getByRole('button', { name: /approve/i })
    await expect(approveBtn).toBeVisible()
    await approveBtn.click()

    await expect(page.getByText(/approved|added/i).first()).toBeVisible({ timeout: 5_000 })
  })
})
