import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'

test.describe('library reconciliation', () => {
  test('reconciliation page renders for an admin session', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    test.skip(!token, 'Requires a working local Postgres test database')
    if (!token) return

    await installAuthToken(page, token)

    await page.goto('/library/reconciliation')
    await expect(page.getByRole('heading', { name: 'Unreconciled Artists' })).toBeVisible()
  })
})
