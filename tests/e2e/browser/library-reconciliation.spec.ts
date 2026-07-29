import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthCookie } from './auth'

test.describe('library reconciliation', () => {
  test('reconciliation page renders for an admin session', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    test.skip(!token, 'Requires a working local Postgres test database')
    if (!token) return

    await installAuthCookie(page)

    await page.goto('/library/reconciliation')
    await expect(page.getByRole('heading', { name: 'Unreconciled Artists' })).toBeVisible()
  })

  test('bulk ignores only eligible visible artists after confirmation', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    test.skip(!token, 'Requires a working local Postgres test database')
    if (!token) return

    await installAuthCookie(page)

    await page.route('**/api/v1/library/unreconciled', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 1,
              userId: 1,
              source: 'plex',
              sourceArtistId: 'artist-1',
              name: 'Signals in Static',
              nameNormalized: 'signals in static',
              mbid: null,
              matchMethod: null,
              matchConfidence: null,
              unreconciledReason: 'ambiguous',
              genres: ['ambient'],
              syncedAt: '2026-07-22T08:00:00.000Z',
              lastGapCheckAt: null,
            },
            {
              id: 2,
              userId: 1,
              source: 'plex',
              sourceArtistId: 'artist-2',
              name: 'Transient Failure',
              nameNormalized: 'transient failure',
              mbid: null,
              matchMethod: null,
              matchConfidence: null,
              unreconciledReason: 'lookup_failed',
              genres: null,
              syncedAt: '2026-07-22T08:00:00.000Z',
              lastGapCheckAt: null,
            },
          ],
        }),
      })
    })
    await page.route('**/api/v1/library/unreconciled-albums', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      })
    })
    await page.route('**/api/v1/library/overrides/bulk-ignore', async (route) => {
      await route.fulfill({ status: 204 })
    })

    await page.goto('/library/reconciliation')

    await expect(page.getByText('Ambiguous match', { exact: true })).toBeVisible()
    await expect(page.getByText('Lookup failed', { exact: true })).toBeVisible()

    const ambiguousCheckbox = page.getByRole('checkbox', {
      name: 'Select artist Signals in Static',
    })
    const failedCheckbox = page.getByRole('checkbox', { name: 'Select artist Transient Failure' })
    await expect(ambiguousCheckbox).not.toBeChecked()
    await expect(failedCheckbox).toBeDisabled()

    await page.getByRole('button', { name: 'Select visible' }).first().click()
    await expect(ambiguousCheckbox).toBeChecked()
    await expect(failedCheckbox).not.toBeChecked()
    await expect(page.getByText('Selected: 1', { exact: true }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Ignore selected' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Ignore selected artists?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      'Selected: 1. This selection will stay ignored until its saved overrides are removed.',
    )

    const artistPost = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/v1/library/overrides/bulk-ignore',
    )
    await dialog.getByRole('button', { name: 'Confirm' }).click()
    const request = await artistPost

    expect(request.postDataJSON()).toEqual({
      items: [{ source: 'plex', sourceArtistId: 'artist-1' }],
    })
    await expect(page.getByText('Selected: 0', { exact: true }).first()).toBeVisible()
  })
})
