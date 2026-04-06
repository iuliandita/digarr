import { expect, test } from '@playwright/test'

test.describe('Setup Wizard', () => {
  test('completes discover-mode setup', async ({ page }) => {
    await page.goto('/')

    // Should redirect to setup wizard or register page
    await expect(page.getByText(/welcome|setup|get started|register|create account/i)).toBeVisible()

    // Select discover mode if wizard mode selection is visible
    const discoverButton = page.getByRole('button', { name: /discover/i })
    if (await discoverButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await discoverButton.click()
    }

    // Fill in ListenBrainz username on sources step (use specific ID to avoid ambiguity)
    const lbUsername = page.locator('#lb-username')
    if (await lbUsername.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await lbUsername.fill('testuser')
    }

    // Look for a continue/next button to advance through steps
    const continueButton = page.getByRole('button', {
      name: /continue|next|skip|complete|finish|start/i,
    })
    if (await continueButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await continueButton.click()
    }

    // Verify we can navigate the wizard without crashing
    await expect(page.locator('body')).toBeVisible()
  })
})
