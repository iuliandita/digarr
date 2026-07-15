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

  test('overflow controls are keyboard accessible', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 800 })
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await installBrowserLocale(page, 'en')
    await installAuthToken(page, token)
    await page.goto('/settings')

    const scrollRight = page.getByRole('button', { name: 'Scroll settings tabs right' })
    await expect(scrollRight).toBeVisible()
    await scrollRight.focus()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('button', { name: 'Scroll settings tabs left' })).toBeVisible()

    await page.goto('/settings?tab=administration')
    const activeTab = page.getByRole('button', { name: 'Administration' })
    const tabStrip = page.getByTestId('settings-tabs-scroll')
    await expect(activeTab).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Scroll settings tabs right' })).toBeVisible()
    await expect
      .poll(async () => {
        const [activeBox, stripBox] = await Promise.all([
          activeTab.boundingBox(),
          tabStrip.boundingBox(),
        ])
        if (!activeBox || !stripBox) return 0
        return stripBox.x + stripBox.width - (activeBox.x + activeBox.width)
      })
      .toBeGreaterThanOrEqual(60)
  })
})
