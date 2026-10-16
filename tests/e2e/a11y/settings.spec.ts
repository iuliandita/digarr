import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthCookie, installBrowserLocale } from '../browser/auth'

test.describe('Settings page a11y', () => {
  test('has no WCAG A/AA violations', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await installBrowserLocale(page, 'en')
    await installAuthCookie(page)
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

  test('section navigation is keyboard accessible', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await installBrowserLocale(page, 'en')
    await installAuthCookie(page)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/settings')
    const nav = page.getByRole('navigation', { name: 'Settings' })
    const administration = nav.getByRole('button', { name: 'Administration' })
    await administration.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=administration/)
    await expect(administration).toHaveAttribute('aria-current', 'page')

    await page.setViewportSize({ width: 390, height: 800 })
    const select = page.getByTestId('settings-section-select')
    await expect(select).toBeVisible()
    await expect(nav).toBeHidden()
    await select.focus()
    await select.selectOption('account')
    await expect(page).toHaveURL(/tab=account/)
  })
})
