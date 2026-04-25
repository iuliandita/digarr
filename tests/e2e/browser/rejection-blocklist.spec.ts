import { expect, test } from '@playwright/test'

test.describe('rejection picker + blocklist', () => {
  // Requires authenticated session + seeded recommendations - same harness
  // gap that keeps approve-reject.spec.ts under test.fixme. Enable in tandem
  // once the pipeline-seed fixture lands.
  test.fixme('reject with reason + permanent block, then unblock', async ({ page }) => {
    await page.goto('/discover')

    // Open the picker via the reject control
    const card = page.locator('[role="button"]').first()
    await expect(card).toBeVisible({ timeout: 5_000 })
    const artistName = (await card.locator('h2,h3').first().textContent())?.trim()
    expect(artistName, 'expected to capture artist name from discover card').toBeTruthy()
    await card.hover()
    await card.getByRole('button', { name: /reject/i }).click()

    // Picker opens
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Pick reason and tick permanent
    await dialog.getByRole('button', { name: /tried it, didn't like it/i }).click()
    await dialog.getByLabel(/don't show this artist again/i).check()

    // Submit (label flips to "Block forever" once permanent is checked)
    await dialog.getByRole('button', { name: /block forever/i }).click()
    await expect(dialog).toBeHidden()

    // Navigate to Settings -> Blocked tab and verify the artist is listed
    await page.goto('/settings')
    await page.getByRole('button', { name: /^blocked$/i }).click()
    if (artistName) {
      await expect(page.getByText(artistName)).toBeVisible()
    }

    // Unblock removes it
    await page
      .getByRole('button', { name: /unblock/i })
      .first()
      .click()
    if (artistName) {
      await expect(page.getByText(artistName)).toBeHidden({ timeout: 3_000 })
    }
  })

  test.fixme('not_right_now disables the permanent checkbox', async ({ page }) => {
    await page.goto('/discover')
    const card = page.locator('[role="button"]').first()
    await expect(card).toBeVisible({ timeout: 5_000 })
    await card.hover()
    await card.getByRole('button', { name: /reject/i }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /maybe later, not now/i }).click()
    const checkbox = dialog.getByLabel(/don't show this artist again/i)
    await expect(checkbox).toBeDisabled()
  })
})
