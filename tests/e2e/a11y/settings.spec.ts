import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken, installBrowserLocale } from '../browser/auth'

test.describe('Settings page a11y', () => {
  test('has no WCAG A/AA violations', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await installBrowserLocale(page, 'en')
    await installAuthToken(page, token)
    await page.goto('/settings')

    await expect(page.getByRole('main')).toBeVisible({
      timeout: 10_000,
    })

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['region'])
      .analyze()

    if (results.violations.length) {
      console.log(JSON.stringify(results.violations, null, 2))
    }
    expect(results.violations).toEqual([])
  })
})
