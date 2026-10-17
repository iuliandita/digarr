import type { APIRequestContext, Page } from '@playwright/test'

export type SeededArtist = { id: number; mbid: string; name: string }

export type SeedResult = {
  batchId: number
  seeded: number
  artists: SeededArtist[]
}

/**
 * Calls the test-only seed route to create a fixed set of pending
 * recommendations for the authenticated user. The route only exists when the
 * backend runs with NODE_ENV=test (see playwright.config.ts webServer env).
 */
export async function seedRecommendations(
  request: APIRequestContext,
  token: string,
): Promise<SeedResult> {
  const res = await request.post('/api/v1/test/seed-recommendations', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) {
    throw new Error(`seed-recommendations failed: ${res.status()} ${await res.text()}`)
  }
  return (await res.json()) as SeedResult
}

/**
 * Force a specific discover view before navigation (like installAuthCookie).
 * - 'list'/'grid' render RecommendationCard (data-testid="rec-card-button") with
 *   approve/reject buttons + an expandable enrichment panel.
 * - 'stack' renders the swipe CardStack.
 * Reject opens the RejectionPicker dialog (reason + permanent block) in every view;
 * only the stack defers the PATCH behind a ~250ms exit animation.
 */
async function installDiscoverView(page: Page, mode: 'grid' | 'list' | 'stack'): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem('digarr:discover-view', value)
  }, mode)
}

export function installDiscoverListView(page: Page): Promise<void> {
  return installDiscoverView(page, 'list')
}

export function installDiscoverStackView(page: Page): Promise<void> {
  return installDiscoverView(page, 'stack')
}
