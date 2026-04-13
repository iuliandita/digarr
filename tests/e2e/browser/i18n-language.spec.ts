import { expect, test } from '@playwright/test'
import { getMessages } from '@/core/i18n/messages'
import { ensureAdminToken, installAuthToken, installBrowserLocale } from './auth'

test.describe('Language switching', () => {
  test('pre-login language switcher persists the selected locale', async ({ page }) => {
    const english = getMessages('en')
    const french = getMessages('fr')
    const token = await ensureAdminToken(page.request)
    expect(token).toBeTruthy()

    await installBrowserLocale(page, 'en')
    await page.goto('/')

    const languageSwitcher = page.getByTestId('language-switcher')
    await expect(languageSwitcher).toHaveValue('en')
    await expect(page.getByRole('button', { name: english['auth.signIn'] })).toBeVisible()

    await languageSwitcher.selectOption('fr')
    await expect(languageSwitcher).toHaveValue('fr')
    await expect(page.getByRole('button', { name: french['auth.signIn'] })).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('digarr-locale')))
      .toBe('fr')

    await page.reload()

    await expect(languageSwitcher).toHaveValue('fr')
    await expect(page.getByRole('button', { name: french['auth.signIn'] })).toBeVisible()
  })

  test('authenticated top-bar switcher updates the shell without logout', async ({ page }) => {
    const english = getMessages('en')
    const french = getMessages('fr')
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return

    await installBrowserLocale(page, 'en')
    await installAuthToken(page, token)
    await page.goto('/')

    const languageSwitcher = page.getByTestId('language-switcher')
    await expect(page.getByRole('link', { name: english['nav.dashboard'] })).toBeVisible()
    await expect(page.getByRole('button', { name: english['auth.signIn'] })).toHaveCount(0)

    await languageSwitcher.selectOption('fr')

    await expect(languageSwitcher).toHaveValue('fr')
    await expect(page.getByRole('link', { name: french['nav.dashboard'] })).toBeVisible()
    await expect(page.getByRole('button', { name: french['auth.signIn'] })).toHaveCount(0)
  })
})
