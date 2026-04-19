import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken, installBrowserLocale } from '../browser/auth'

test.describe('Setup wizard a11y', () => {
  test('mode-selection screen has no WCAG A/AA violations', async ({ page }) => {
    const token = await ensureAdminToken(page.request)
    expect(token).toBeTruthy()
    if (!token) return
    await installBrowserLocale(page, 'en')
    await installAuthToken(page, token)
    await page.goto('/')

    // Wait for the wizard to render before running axe so the scan doesn't
    // catch a half-hydrated frame.
    await expect(page.getByRole('button', { name: /discover/i })).toBeVisible({ timeout: 10_000 })

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['region'])
      .analyze()

    // Advisory surface: log the full violation set so CI artifacts capture it.
    if (results.violations.length) {
      console.log(JSON.stringify(results.violations, null, 2))
    }
    expect(results.violations).toEqual([])
  })
})
