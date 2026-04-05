import { expect, test } from '@playwright/test'

test.describe('Approve/Reject', () => {
  test('approves a recommendation from discover page', async ({ page }) => {
    await page.goto('/discover')

    const card = page.locator('[role="button"]').first()
    if (await card.isVisible({ timeout: 5_000 })) {
      await card.hover()

      const approveBtn = card.getByRole('button', { name: /approve/i })
      if (await approveBtn.isVisible()) {
        await approveBtn.click()
        await expect(page.getByText(/approved|added/i)).toBeVisible({ timeout: 3_000 })
      }
    }
  })
})
