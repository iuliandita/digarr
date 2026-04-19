import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'

test.describe('library album coverage', () => {
  test('shows the album coverage popover from discover', async ({ page }) => {
    const token = await ensureAdminToken(page.request, { completeSetup: true })
    test.skip(!token, 'Requires a working local Postgres test database')
    if (!token) return

    await installAuthToken(page, token)

    await page.route('**/api/v1/recommendations**', async (route) => {
      const url = new URL(route.request().url())
      const status = url.searchParams.get('status')
      const isPendingList = status === 'pending' || status === null

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: isPendingList
            ? [
                {
                  id: 1,
                  score: 0.82,
                  status: 'pending',
                  aiReasoning: 'Great match for your indie taste.',
                  sources: { listenbrainz: 0.9, lastfm: 0.7 },
                  lidarrError: null,
                  recommendedReleaseGroupId: null,
                  recommendedReleaseGroupTitle: null,
                  artist: {
                    id: 10,
                    name: 'Radiohead',
                    mbid: 'mbid-001',
                    disambiguation: null,
                    genres: ['rock', 'alternative', 'art rock'],
                    tags: null,
                    imageUrl: null,
                    streamingUrls: null,
                  },
                },
              ]
            : [],
          total: isPendingList ? 1 : 0,
        }),
      })
    })

    await page.route('**/api/v1/warm-status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ statuses: {} }),
      })
    })

    await page.route('**/api/v1/targets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route('**/api/v1/library/album-coverage/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          artistMbid: 'mbid-001',
          ownedCount: 3,
          totalCount: 8,
          owned: [{ albumMbid: 'owned-a', title: 'Owned A', releaseYear: 2001 }],
          missing: [{ albumMbid: 'missing-b', title: 'Missing B', releaseYear: 2004 }],
        }),
      })
    })

    await page.goto('/discover')

    const recommendationCard = page
      .locator('[role="button"]')
      .filter({ hasText: 'Radiohead' })
      .first()
    await expect(recommendationCard).toBeVisible()
    await recommendationCard.scrollIntoViewIfNeeded()
    const coverageButton = recommendationCard.getByRole('button', {
      name: /you own .*studio albums/i,
    })
    await expect(coverageButton).toBeVisible()
    await coverageButton.click()

    await expect(page.getByText('Owned A (2001)')).toBeVisible()
    await expect(page.getByText('Missing B (2004)')).toBeVisible()
  })
})
