import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthCookie } from './auth'
import { installDiscoverListView, seedRecommendations } from './seed'

test.describe('Metadata enrichment', () => {
  test.beforeEach(async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await seedRecommendations(page.request, token)
    await installAuthCookie(page)
    await installDiscoverListView(page)
  })

  test('recommendation card expansion shows bio and external links', async ({ page }) => {
    await page.goto('/discover')
    const firstCard = page.locator('[data-testid="rec-card-button"]').first()
    await expect(firstCard).toBeVisible({ timeout: 10_000 })
    await firstCard.click()

    const enrichment = firstCard.getByTestId('artist-enrichment')
    await expect(enrichment.getByTestId('artist-bio')).toBeVisible({ timeout: 10_000 })
    // Seeded bio text proves the cached Wikidata description is served.
    await expect(enrichment.getByTestId('artist-bio')).toContainText(/fictional/i)
    // MusicBrainz pill (built from mbid). Scope to the enrichment panel + exact
    // name so it doesn't collide with the "View on MusicBrainz" top-tracks link.
    await expect(enrichment.getByRole('link', { name: 'MusicBrainz', exact: true })).toBeVisible()
  })

  test('settings toggle hides Wikidata bio from cards after reload', async ({ page }) => {
    // Image-source controls live in Connections under Artist images.
    await page.goto('/settings')
    const images = page.getByRole('group', { name: 'Artist images', exact: true })
    await images.getByRole('button', { expanded: false }).click()
    await images.getByLabel(/bio and external links/i).uncheck()
    await images.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Artist images settings saved', { exact: true })).toBeVisible({
      timeout: 5_000,
    })

    // Reload discover: the backend now returns an empty enrichment payload, so
    // the seeded bio text is gone while the mbid-built MusicBrainz pill remains.
    await page.goto('/discover')
    const firstCard = page.locator('[data-testid="rec-card-button"]').first()
    await expect(firstCard).toBeVisible({ timeout: 10_000 })
    await firstCard.click()

    const enrichment = firstCard.getByTestId('artist-enrichment')
    await expect(enrichment.getByRole('link', { name: 'MusicBrainz', exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await expect(enrichment.getByTestId('artist-bio')).not.toContainText(/fictional/i)
  })
})
