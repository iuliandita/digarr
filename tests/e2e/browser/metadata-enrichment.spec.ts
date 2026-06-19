import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'
import { installDiscoverListView, seedRecommendations } from './seed'

test.describe('Metadata enrichment', () => {
  test.beforeEach(async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    expect(token).toBeTruthy()
    if (!token) return
    await seedRecommendations(page.request, token)
    await installAuthToken(page, token)
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
    // Disable "Show artist bio and external links" in the Recommendations tab.
    // The toggle lives inside the collapsed "Advanced" section, so expand it first.
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Recommendations' }).first().click()
    await page.getByRole('button', { name: 'Advanced', exact: true }).first().click()
    await page.getByLabel(/bio and external links/i).uncheck()
    await page.getByRole('button', { name: 'Save', exact: true }).first().click()
    await expect(page.getByText(/recommendation settings saved/i)).toBeVisible({ timeout: 5_000 })

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
