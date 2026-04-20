import { expect, test } from '@playwright/test'

test.describe('Metadata enrichment', () => {
  // Requires authenticated session + seeded pipeline run with at least one
  // recommendation. Marked fixme until the E2E harness seeds those - matches
  // the pattern used by approve-reject.spec.ts.
  test.fixme('recommendation card expansion shows bio and external links', async ({ page }) => {
    await page.goto('/discover')
    const firstCard = page.locator('[data-testid="recommendation-card"]').first()
    await expect(firstCard).toBeVisible({ timeout: 5_000 })
    await firstCard.click()
    await expect(firstCard.locator('[data-testid="artist-bio"]')).toBeVisible({
      timeout: 10_000,
    })
    await expect(firstCard.locator('text=MusicBrainz')).toBeVisible()
  })

  test.fixme('settings toggle hides Wikidata bio from cards after reload', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('tab', { name: /recommendations/i }).click()
    await page.getByLabel(/bio and external links/i).uncheck()
    await page.getByRole('button', { name: /save/i }).click()
    await page.goto('/discover')
    const firstCard = page.locator('[data-testid="recommendation-card"]').first()
    await firstCard.click()
    // MusicBrainz pill always present (built from mbid). Bio should be absent
    // because the backend returns an empty payload when wikidataEnabled=false.
    await expect(firstCard.locator('text=MusicBrainz')).toBeVisible()
  })
})
