import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { DEFAULT_DASHBOARD_LAYOUT } from '@/core/dashboard-layout'
import { ensureAdminToken, installAuthCookie, installBrowserLocale } from '../browser/auth'

test('dashboard and customization controls have no WCAG A/AA violations', async ({ page }) => {
  const token = await ensureAdminToken(page.request, { completeSetup: true })
  expect(token).toBeTruthy()
  if (!token) return
  const save = (showEmpty: boolean) =>
    page.request.patch('/api/v1/auth/me/preferences', {
      headers: { Authorization: `Bearer ${token}` },
      data: { dashboardLayout: { ...DEFAULT_DASHBOARD_LAYOUT, showEmpty } },
    })
  expect((await save(true)).ok()).toBe(true)
  await installBrowserLocale(page, 'en')
  await installAuthCookie(page)
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
    await expect(page.locator('[data-dashboard-card]')).toHaveCount(5)
    for (const customize of [false, true]) {
      if (customize) await page.getByRole('button', { name: 'Customize', exact: true }).click()
      expect(
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
      ).toEqual([])
    }
  } finally {
    expect((await save(false)).ok()).toBe(true)
  }
})
