import { expect, test } from '@playwright/test'
import { getMessages } from '@/core/i18n/messages'
import { ensureAdminToken, installAuthToken } from './auth'

test('runs a discovery mode manually and saves one as a subscription', async ({ page }) => {
  const locale = 'ru'
  const messages = getMessages(locale)
  const token = await ensureAdminToken(page.request, {
    completeSetup: true,
    preferredLocale: locale,
  })
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
          reason: 'This mode is not implemented yet.',
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
          reason: 'This mode is not implemented yet.',
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

  await page.route('**/api/v1/discovery-modes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(discoveryModes),
    })
  })
  await page.route('**/api/v1/discovery-modes/run', async (route) => {
    runRequestBody = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Discovery run started' }),
    })
  })
  await page.route('**/api/v1/subscriptions', async (route) => {
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

  await page.goto('/')
  await page.getByRole('button', { name: messages['nav.discover'], exact: true }).click()
  await page.getByRole('menuitem', { name: messages['nav.discoveryModes'] }).click()
  await expect(page).toHaveURL('/discover/modes')
  await expect(
    page.getByRole('heading', { name: messages['discover.discoveryModes'] }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: messages['nav.recommendations'] })).toBeVisible()
  await page.getByRole('button', { name: messages['nav.discover'], exact: true }).click()
  await expect(
    page.getByRole('button', { name: messages['nav.discover'], exact: true }),
  ).toHaveClass(/text-accent/)
  await expect(page.getByRole('menuitem', { name: messages['nav.recommendations'] })).toHaveClass(
    /text-text/,
  )
  await expect(page.getByRole('menuitem', { name: messages['nav.discoveryModes'] })).toHaveClass(
    /text-accent/,
  )
  await expect(
    page.getByRole('heading', { name: messages['discoveryMode.listenbrainz.label'] }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: messages['discoveryMode.release-radar.label'] }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: messages['discoveryMode.artist-relationships.label'] }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: messages['discoveryMode.similar-artist-web.label'] }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: messages['discoveryMode.labels.label'] }),
  ).toBeVisible()
  await expect(page.getByText(messages['discoveryMode.reason.notImplementedYet'])).toHaveCount(2)

  const releaseRadarCard = page
    .getByRole('heading', { name: messages['discoveryMode.release-radar.label'] })
    .locator('xpath=ancestor::article[1]')
  await releaseRadarCard.getByLabel(messages['discoveryMode.field.releaseWindow']).fill('14')
  await releaseRadarCard
    .getByRole('button', { name: messages['discoveryMode.runDiscovery'] })
    .click()
  await expect(page.getByText(messages['discover.discoveryRunStarted'])).toBeVisible()
  expect(runRequestBody).toEqual({
    modeId: 'release-radar',
    settingsMode: 'easy',
    rawUserSettings: { windowDays: 14 },
    normalizedSettings: { windowDays: 14 },
    providerContext: { providerPath: ['lastfm'] },
    fallbackPolicy: 'allow-fallback',
  })

  await page.goto('/subscriptions')
  await page.getByRole('button', { name: messages['subscriptions.new'] }).click()
  await page.getByLabel(messages['subscriptionForm.name']).fill('Radar Weekly')
  await page.getByLabel(messages['subscriptionForm.sourceType']).selectOption('discovery-mode')
  await page.getByLabel(messages['subscriptionForm.discoveryMode']).selectOption('release-radar')
  await page.getByLabel(messages['discoveryMode.field.releaseWindow']).fill('14')
  await page.getByRole('button', { name: messages['common.create'] }).click()

  const subscriptionCard = page.locator('div.bg-surface.border.border-border.rounded-lg').filter({
    has: page.getByText('Radar Weekly'),
  })
  await expect(subscriptionCard.getByText('Radar Weekly')).toBeVisible()
  await expect(subscriptionCard.getByText('release-radar').first()).toBeVisible()
})
