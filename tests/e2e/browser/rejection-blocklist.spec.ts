import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'
import { installDiscoverStackView, seedRecommendations } from './seed'

// The reason picker (reason + permanent block) only renders in the swipe
// "stack" view, so these tests force that view before navigating.
test.describe('rejection picker + blocklist', () => {
  test.beforeEach(async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await seedRecommendations(page.request, token)
    await installAuthToken(page, token)
    await installDiscoverStackView(page)
  })

  test('reject with reason + permanent block, then unblock', async ({ page }) => {
    await page.goto('/discover')

    // Open the picker via the stack-card reject control.
    await page
      .getByRole('button', { name: /^reject$/i })
      .first()
      .click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Picker title is "<prompt> - <artistName>"; capture the name to verify it
    // later shows up (and disappears) in the Blocked settings tab.
    const title = (await dialog.locator('h2').first().textContent()) ?? ''
    const artistName = title.includes(' - ') ? title.split(' - ').slice(1).join(' - ').trim() : ''
    expect(artistName, 'expected to capture artist name from picker title').toBeTruthy()

    // Pick reason and tick permanent
    await dialog.getByRole('button', { name: /tried it, didn't like it/i }).click()
    await dialog.getByLabel(/don't show this artist again/i).check()

    // Submit (label flips to "Block forever" once permanent is checked). The
    // stack view defers the actual reject PATCH behind a 250ms exit animation,
    // so wait for it to land before navigating away, or the block write aborts.
    const rejectPatch = page.waitForResponse(
      (r) => /\/api\/v1\/recommendations\/\d+$/.test(r.url()) && r.request().method() === 'PATCH',
    )
    await dialog.getByRole('button', { name: /block forever/i }).click()
    await expect(dialog).toBeHidden()
    await rejectPatch

    // Navigate to Settings -> Blocked tab and verify the artist is listed
    await page.goto('/settings')
    await page.getByRole('button', { name: /^blocked$/i }).click()
    await expect(page.getByText(artistName)).toBeVisible({ timeout: 5_000 })

    // Unblock removes it
    await page
      .getByRole('button', { name: /unblock/i })
      .first()
      .click()
    await expect(page.getByText(artistName)).toBeHidden({ timeout: 5_000 })
  })

  test('not_right_now disables the permanent checkbox', async ({ page }) => {
    await page.goto('/discover')
    await page
      .getByRole('button', { name: /^reject$/i })
      .first()
      .click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: /maybe later, not now/i }).click()
    const checkbox = dialog.getByLabel(/don't show this artist again/i)
    await expect(checkbox).toBeDisabled()
  })
})
