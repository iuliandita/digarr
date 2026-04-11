import { expect, test } from '@playwright/test'
import { ensureAdminToken, installAuthToken } from './auth'

test('runs a discovery mode manually and saves one as a subscription', async ({ page }) => {
  const token = await ensureAdminToken(page.request, { completeSetup: true })
  expect(token).toBeTruthy()
  if (!token) return

  const discoveryModes = {
    modes: [
      {
        id: 'listenbrainz',
        label: 'ListenBrainz',
        description: 'Discover from ListenBrainz graph data and feeds',
        availability: {
          enabled: true,
          fallbackUsed: false,
          providerPath: ['listenbrainz'],
        },
        easyFields: [
          {
            key: 'feedType',
            label: 'Feed',
            type: 'select',
            required: true,
            options: [{ value: 'weekly-jams', label: 'Weekly Jams' }],
          },
        ],
        advancedFields: [
          {
            key: 'feedType',
            label: 'Feed',
            type: 'select',
            required: true,
            options: [{ value: 'weekly-jams', label: 'Weekly Jams' }],
          },
          { key: 'limit', label: 'Limit', type: 'number', required: true },
        ],
      },
      {
        id: 'release-radar',
        label: 'Release Radar',
        description: 'Discover from new releases connected to your tracked artists',
        availability: {
          enabled: true,
          fallbackUsed: true,
          providerPath: ['lastfm'],
          reason: 'Using fallback providers for release discovery.',
        },
        easyFields: [
          { key: 'windowDays', label: 'Release window', type: 'number', required: true },
        ],
        advancedFields: [
          { key: 'windowDays', label: 'Release window', type: 'number', required: true },
        ],
      },
      {
        id: 'artist-relationships',
        label: 'Artist Relationships',
        description: 'Discover collaborators, aliases, and adjacent artist graph edges',
        availability: {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'This mode is not shipped yet.',
        },
        easyFields: [
          { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
        ],
        advancedFields: [
          { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
          { key: 'depth', label: 'Depth', type: 'number', required: false },
        ],
      },
      {
        id: 'similar-artist-web',
        label: 'Similar Artist Web',
        description: 'Discover artists from web-based similar artist graph lookups',
        availability: {
          enabled: true,
          fallbackUsed: true,
          providerPath: ['musicbrainz'],
          reason: 'Preferred provider unavailable; fallback will be used.',
        },
        easyFields: [
          { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
        ],
        advancedFields: [
          { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
          { key: 'depth', label: 'Depth', type: 'number', required: false },
        ],
      },
      {
        id: 'labels',
        label: 'Labels',
        description: 'Discover artists connected through label catalogs',
        availability: {
          enabled: false,
          fallbackUsed: false,
          providerPath: [],
          reason: 'This mode is not shipped yet.',
        },
        easyFields: [
          { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
        ],
        advancedFields: [
          { key: 'seedArtists', label: 'Seed artists', type: 'multiselect', required: true },
          { key: 'limit', label: 'Limit', type: 'number', required: true },
        ],
      },
    ],
  }
  let runRequestBody: Record<string, unknown> | null = null
  let createdSubscription: Record<string, unknown> | null = null

  await page.route('**/api/discovery-modes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(discoveryModes),
    })
  })
  await page.route('**/api/discovery-modes/run', async (route) => {
    runRequestBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Discovery run started' }),
    })
  })
  await page.route('**/api/subscriptions', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      createdSubscription = {
        id: 99,
        userId: 1,
        ...body,
        enabled: true,
        lastRunAt: null,
        lastResultCount: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(createdSubscription),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createdSubscription ? [createdSubscription] : []),
    })
  })

  await installAuthToken(page, token)

  await page.goto('/discover')
  await expect(page.getByRole('heading', { name: 'Discovery Modes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'ListenBrainz' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Release Radar' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Artist Relationships' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Similar Artist Web' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Labels' })).toBeVisible()

  const releaseRadarCard = page
    .getByRole('heading', { name: 'Release Radar' })
    .locator('xpath=ancestor::article[1]')
  await releaseRadarCard.getByLabel('Release window').fill('14')
  await releaseRadarCard.getByRole('button', { name: 'Run discovery' }).click()
  await expect(page.getByText(/discovery run started/i)).toBeVisible()
  await expect(page.getByText(/check dashboard for progress/i)).toBeVisible()
  expect(runRequestBody).toEqual({
    modeId: 'release-radar',
    settingsMode: 'easy',
    rawUserSettings: { windowDays: 14 },
    normalizedSettings: { windowDays: 14 },
    providerContext: { providerPath: ['lastfm'] },
    fallbackPolicy: 'allow-fallback',
  })

  await page.goto('/subscriptions')
  await page.getByRole('button', { name: 'New' }).click()
  await page.getByLabel('Name').fill('Radar Weekly')
  await page.getByLabel('Source Type').selectOption('discovery-mode')
  await page.getByLabel('Discovery Mode').selectOption('release-radar')
  await page.getByLabel('Release window').fill('14')
  await page.getByRole('button', { name: 'Create' }).click()

  const subscriptionCard = page.locator('div.bg-surface.border.border-border.rounded-lg').filter({
    has: page.getByText('Radar Weekly'),
  })
  await expect(subscriptionCard.getByText('Radar Weekly')).toBeVisible()
  await expect(subscriptionCard.getByText('release-radar').first()).toBeVisible()
})
