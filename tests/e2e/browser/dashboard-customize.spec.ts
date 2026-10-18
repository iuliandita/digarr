import { expect, test } from '@playwright/test'
import { DEFAULT_DASHBOARD_LAYOUT } from '@/core/dashboard-layout'
import { ensureAdminToken, installAuthCookie, installBrowserLocale } from './auth'
import { seedRecommendations } from './seed'

test('dashboard edits follow the account across reloads and source pages', async ({ page }) => {
  const token = await ensureAdminToken(page.request, { completeSetup: true })
  expect(token).toBeTruthy()
  if (!token) return
  const reset = () =>
    page.request.patch('/api/v1/auth/me/preferences', {
      headers: { Authorization: `Bearer ${token}` },
      data: { dashboardLayout: DEFAULT_DASHBOARD_LAYOUT },
    })
  expect((await reset()).ok()).toBe(true)
  await seedRecommendations(page.request, token)
  await installBrowserLocale(page, 'en')
  await installAuthCookie(page)
  await page.route('**/api/v1/albums/*', (route) => route.fulfill({ json: [] }))
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Customize', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Customize', exact: true })
    await panel.getByRole('checkbox', { name: 'Show empty cards' }).click()
    await expect(panel.getByRole('checkbox', { name: 'Show empty cards' })).toBeChecked()
    const pick = page.locator('[data-dashboard-card="pick"]')
    await expect(pick).toBeVisible()
    const handle = panel.getByRole('button', { name: "Reorder Today's Pick", exact: true })
    await expect(handle).toBeEnabled()
    await handle.focus()
    await handle.press('ArrowDown')
    await expect(panel.locator('li').first()).toHaveAttribute(
      'data-dashboard-editor-card',
      'decisions',
    )
    await expect(handle).toBeFocused()
    await expect(panel.locator('[aria-live]')).toHaveText("Today's Pick moved to position 2 of 5.")
    // Exercise the same pointer path for mouse and touch-capable handles.
    await expect(handle).toBeEnabled()
    const origin = await handle.boundingBox()
    const destination = await panel.locator('[data-dashboard-editor-card="genres"]').boundingBox()
    expect(origin).toBeTruthy()
    expect(destination).toBeTruthy()
    if (!origin || !destination) return
    await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      destination.x + destination.width / 2,
      destination.y + destination.height / 2,
      { steps: 8 },
    )
    await page.mouse.up()
    await expect(panel.locator('li').nth(3)).toHaveAttribute('data-dashboard-editor-card', 'pick')
    await panel
      .getByRole('combobox', { name: "Size of Today's Pick", exact: true })
      .selectOption('small')
    await expect(pick).toHaveClass(/md:col-span-1/)
    expect(await pick.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await panel.getByRole('checkbox', { name: "Today's Pick", exact: true }).click()
    await expect(pick).toHaveCount(0)
    await expect(panel.getByRole('checkbox', { name: "Today's Pick", exact: true })).toBeEnabled()
    await page.reload()
    await expect(pick).toHaveCount(0)
    await page.getByRole('button', { name: 'Customize', exact: true }).click()
    await expect(
      panel.getByRole('checkbox', { name: "Today's Pick", exact: true }),
    ).not.toBeChecked()
    await expect(
      panel.getByRole('combobox', { name: "Size of Today's Pick", exact: true }),
    ).toHaveValue('small')
    await panel.getByRole('button', { name: 'Reset to default' }).click()
    await expect(pick).toHaveClass(/md:col-span-3/)
    await expect(panel.locator('li').first()).toHaveAttribute('data-dashboard-editor-card', 'pick')
    await expect(panel.getByRole('checkbox', { name: 'Show empty cards' })).not.toBeChecked()
    await expect(panel.getByRole('button', { name: 'Reset to default' })).toBeEnabled()
  } finally {
    expect((await reset()).ok()).toBe(true)
  }
})

test('all card sizes fill the phone grid', async ({ page }) => {
  const token = await ensureAdminToken(page.request, { completeSetup: true })
  expect(token).toBeTruthy()
  if (!token) return
  const save = (layout = DEFAULT_DASHBOARD_LAYOUT) =>
    page.request.patch('/api/v1/auth/me/preferences', {
      headers: { Authorization: `Bearer ${token}` },
      data: { dashboardLayout: layout },
    })
  await save({ ...DEFAULT_DASHBOARD_LAYOUT, showEmpty: true })
  await installBrowserLocale(page, 'en')
  await installAuthCookie(page)
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Customize', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Customize', exact: true })
    for (const size of ['small', 'medium', 'large']) {
      await panel
        .getByRole('combobox', { name: "Size of Today's Pick", exact: true })
        .selectOption(size)
      const card = page.locator('[data-dashboard-card="pick"]')
      await expect(card).toHaveClass(
        new RegExp(`md:col-span-${size === 'small' ? 1 : size === 'medium' ? 2 : 3}`),
      )
      expect(
        await card.evaluate((element) =>
          Math.abs(
            element.getBoundingClientRect().width -
              (element.parentElement?.getBoundingClientRect().width ?? 0),
          ),
        ),
      ).toBeLessThan(1)
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  } finally {
    expect((await save()).ok()).toBe(true)
  }
})

for (const [path, card] of [
  ['/discover', 'pick'],
  ['/genres', 'genres'],
  ['/subscriptions', 'subscriptions'],
  ['/discover?status=approved', 'decisions'],
  ['/settings?tab=connections', 'listening'],
] as const) {
  test(`${card} source page saves dashboard visibility on the account`, async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    const reset = () =>
      page.request.patch('/api/v1/auth/me/preferences', {
        headers: { Authorization: `Bearer ${token}` },
        data: { dashboardLayout: DEFAULT_DASHBOARD_LAYOUT },
      })
    expect((await reset()).ok()).toBe(true)
    await installBrowserLocale(page, 'en')
    await installAuthCookie(page)
    await page.route('**/api/v1/albums/*', (route) => route.fulfill({ json: [] }))
    try {
      await page.goto(path)
      const toggle = page.getByRole('checkbox', { name: 'Show on dashboard' })
      await expect(toggle).toBeChecked()
      await expect(toggle).toBeEnabled()
      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await expect(toggle).toBeEnabled()
      const response = await page.request.get('/api/v1/auth/me/preferences')
      expect(
        (await response.json()).dashboardLayout.cards.find(
          (entry: { id: string }) => entry.id === card,
        ).visible,
      ).toBe(false)
      await page.reload()
      await expect(toggle).not.toBeChecked()
      await toggle.click()
      await expect(toggle).toBeChecked()
      await expect(toggle).toBeEnabled()
      if (card === 'decisions') {
        await expect(page.getByRole('button', { name: /^Approved/ })).toHaveAttribute(
          'aria-pressed',
          'true',
        )
        await page.getByRole('link', { name: 'Discover', exact: true }).last().click()
        await expect(page.getByRole('button', { name: /^Pending/ })).toHaveAttribute(
          'aria-pressed',
          'true',
        )
      }
    } finally {
      expect((await reset()).ok()).toBe(true)
    }
  })
}
