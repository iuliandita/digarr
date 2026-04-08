import { type APIRequestContext, expect, test } from '@playwright/test'

async function ensureAdminToken(request: APIRequestContext): Promise<string | null> {
  const authStatusRes = await request.get('/api/auth/status')
  if (!authStatusRes.ok()) return null
  const authStatus = (await authStatusRes.json()) as { hasUsers?: boolean }

  let token: string | null = null

  if (!authStatus.hasUsers) {
    const registerRes = await request.post('/api/auth/register', {
      data: {
        username: `e2e-admin-${Date.now()}`,
        password: 'e2e-password-123',
      },
    })
    if (!registerRes.ok()) return null
    const registerBody = (await registerRes.json()) as { token?: string }
    token = registerBody.token ?? null
  } else {
    const username = process.env.DIGARR_E2E_USERNAME
    const password = process.env.DIGARR_E2E_PASSWORD
    if (!username || !password) return null

    const loginRes = await request.post('/api/auth/login', {
      data: { username, password },
    })
    if (!loginRes.ok()) return null
    const loginBody = (await loginRes.json()) as { token?: string }
    token = loginBody.token ?? null

    if (!token) return null

    const meRes = await request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!meRes.ok()) return null
    const me = (await meRes.json()) as { isAdmin?: boolean }
    if (!me.isAdmin) return null
  }

  if (!token) return null

  const setupStatusRes = await request.get('/api/setup/status', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!setupStatusRes.ok()) return null
  const setupStatus = (await setupStatusRes.json()) as { setupComplete?: boolean }

  if (!setupStatus.setupComplete) {
    const completeRes = await request.post('/api/setup/complete', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        aiProvider: 'openai',
        aiModel: 'gpt-5.4-mini',
        listenbrainzUsername: 'e2e-listener',
      },
    })
    if (!completeRes.ok() && completeRes.status() !== 409) return null
  }

  return token
}

test.describe('library album coverage', () => {
  test('shows the album coverage popover from discover', async ({ page }) => {
    const token = await ensureAdminToken(page.request)
    test.skip(
      !token,
      'Requires a bootstrap admin user or DIGARR_E2E_USERNAME / DIGARR_E2E_PASSWORD',
    )
    if (!token) return

    await page.addInitScript((value) => {
      window.localStorage.setItem('digarr-auth-token', value)
    }, token)

    await page.route('**/api/recommendations**', async (route) => {
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

    await page.route('**/api/warm-status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ statuses: {} }),
      })
    })

    await page.route('**/api/targets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.route('**/api/library/album-coverage/**', async (route) => {
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

    const coverageButton = page.getByRole('button', { name: /studio albums/i }).first()
    await expect(coverageButton).toBeVisible()
    await coverageButton.click()

    await expect(page.getByText('Owned')).toBeVisible()
    await expect(page.getByText('Missing')).toBeVisible()
  })
})
