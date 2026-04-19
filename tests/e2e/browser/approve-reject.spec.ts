import { expect, test } from '@playwright/test'

test.describe('Approve/Reject', () => {
  // Requires authenticated session + seeded recommendations. Without those
  // the discover page shows an empty state and the old "silent skip" on
  // `isVisible()` let this test pass without proving anything. Re-enable
  // once the E2E harness seeds a pipeline run (tracked as follow-up work).
  test.fixme('approves a recommendation from discover page', async ({ page }) => {
    await page.goto('/discover')

    const card = page.locator('[role="button"]').first()
    await expect(card).toBeVisible({ timeout: 5_000 })
    await card.hover()

    const approveBtn = card.getByRole('button', { name: /approve/i })
    await expect(approveBtn).toBeVisible()
    await approveBtn.click()
    await expect(page.getByText(/approved|added/i)).toBeVisible({ timeout: 3_000 })
  })
})
