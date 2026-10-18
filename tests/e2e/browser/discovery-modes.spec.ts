import { expect, test } from '@playwright/test'
import { getMessages } from '@/core/i18n/messages'
import { ensureAdminToken, installAuthCookie } from './auth'

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

  await installAuthCookie(page)

  await page.goto('/')
  const mainNav = page.getByRole('navigation', { name: messages['app.mainNavigation'] })
  await mainNav.getByRole('link', { name: messages['nav.discover'], exact: true }).click()
  await expect(page).toHaveURL('/discover')
  const discoverTabs = page.getByRole('navigation', { name: messages['nav.discover'] })
  await discoverTabs.getByRole('link', { name: messages['nav.discoveryModes'] }).click()
  await expect(page).toHaveURL('/discovery-modes')
  await expect(
    page.getByRole('heading', { name: messages['discover.discoveryModes'] }),
  ).toBeVisible()
  await expect(
    mainNav.getByRole('link', { name: messages['nav.discover'], exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    discoverTabs.getByRole('link', { name: messages['nav.discoveryModes'] }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    discoverTabs.getByRole('link', { name: messages['nav.recommendations'] }),
  ).not.toHaveAttribute('aria-current', 'page')
  await expect(
    page.getByRole('heading', { name: messages['discoveryModes.yourModes'] }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: messages['discoveryMode.release-radar.label'] }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: messages['discoveryModes.runMode'] }).click()
  const search = page.getByRole('searchbox', { name: messages['discoveryModes.searchModes'] })
  await expect(search).toBeFocused()
  await search.fill(messages['discoveryMode.release-radar.label'])
  await expect(
    page.getByRole('button', { name: messages['discoveryMode.release-radar.label'], exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: messages['discoveryMode.listenbrainz.label'], exact: true }),
  ).toHaveCount(0)
  await search.fill(messages['discoveryMode.labels.label'])
  await expect(page.getByText(messages['discoveryMode.notImplementedYet'])).toBeVisible()

  await page.goto('/discover/modes?mode=release-radar')

  const releaseRadarCard = page
    .getByRole('heading', { name: messages['discoveryMode.release-radar.label'] })
    .locator('xpath=ancestor::article[1]')
  await expect(releaseRadarCard).toBeVisible()
  await expect(releaseRadarCard).toBeFocused()
  await releaseRadarCard.getByLabel(messages['discoveryMode.field.releaseWindow']).fill('14')
  await releaseRadarCard.getByRole('button', { name: messages['subscriptions.runNow'] }).click()
  await expect(page.getByText(messages['discover.discoveryRunStarted'])).toBeVisible()
  expect(runRequestBody).toEqual({
    modeId: 'release-radar',
    settingsMode: 'easy',
    rawUserSettings: { windowDays: 14 },
    normalizedSettings: { windowDays: 14 },
    providerContext: { providerPath: ['lastfm'] },
    fallbackPolicy: 'allow-fallback',
  })

  await releaseRadarCard
    .getByRole('button', { name: messages['common.schedule'], exact: true })
    .click()
  await page.getByLabel(messages['subscriptionForm.name']).fill('Radar Weekly')
  await page.getByRole('button', { name: messages['common.create'], exact: true }).click()

  const subscriptionCard = page.getByTestId('subscription-card').filter({
    has: page.getByText('Radar Weekly'),
  })
  await expect(subscriptionCard.getByText('Radar Weekly')).toBeVisible()
  expect(createdSubscription).toMatchObject({
    sourceType: 'discovery-mode',
    sourceConfig: { modeId: 'release-radar', settings: { windowDays: 14 } },
  })
  const expand = subscriptionCard.getByRole('button', { name: 'Radar Weekly', exact: true })
  await expand.click()
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expect(subscriptionCard.getByLabel(messages['subscriptionForm.name'])).toHaveValue(
    'Radar Weekly',
  )

  await page.goto('/subscriptions')
  await expect(page).toHaveURL('/discovery-modes')
  await expect(page.getByText('Radar Weekly')).toBeVisible()
  await page.goto('/settings?tab=schedule')
  await expect(
    page.getByRole('heading', { name: messages['settings.scheduleOverview'] }),
  ).toBeVisible()
  await page.getByRole('link', { name: `${messages['common.edit']}: Radar Weekly` }).click()
  await expect(page).toHaveURL(/\/discovery-modes(?:\?subscription=99)?$/)
  await expect(page.getByLabel(messages['subscriptionForm.name'])).toHaveValue('Radar Weekly')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
})
