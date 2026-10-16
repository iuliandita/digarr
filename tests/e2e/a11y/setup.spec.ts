import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { getMessages } from '@/core/i18n/messages'
import { ensureAdminToken, installAuthCookie, installBrowserLocale } from '../browser/auth'

test.describe('Setup wizard a11y', () => {
  test('mode-selection screen has no WCAG A/AA violations', async ({ page }) => {
    const token = await ensureAdminToken(page.request)
    expect(token).toBeTruthy()
    if (!token) return
    await installBrowserLocale(page, 'en')
    await installAuthCookie(page)
    // Other a11y specs complete setup on the shared database; pin the wizard regardless of order.
    await page.route('**/api/v1/setup/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"setupComplete":false}',
      }),
    )
    await page.goto('/')

    // Wait for the wizard to render before running axe so the scan doesn't
    // catch a half-hydrated frame.
    await expect(
      page.getByRole('heading', { name: getMessages('en')['setup.howManageMusic'] }),
    ).toBeVisible({
      timeout: 10_000,
    })

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
