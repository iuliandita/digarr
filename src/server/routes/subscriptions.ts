import { Cron } from 'croner'
import { Hono } from 'hono'
import {
  buildDiscoveryModeExecutionContext,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import type { DiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import { DISCOVERY_MODE_SUBSCRIPTION_TYPE } from '@/core/subscriptions/registry'
import { errMsg } from '@/core/validation'
import { getOAuthToken } from '@/db/queries/oauth-tokens'
import type { AppDependencies } from '@/server'
import type { HonoEnv } from '@/server/types'

/** Extract the bare playlist ID from a URL, URI, or raw ID. */
function extractPlaylistId(raw: string): string {
  const uriMatch = raw.match(/spotify:playlist:([A-Za-z0-9]+)/)
  if (uriMatch?.[1]) return uriMatch[1]
  const urlMatch = raw.match(/\/playlist\/([A-Za-z0-9]+)/)
  if (urlMatch?.[1]) return urlMatch[1]
  return raw.trim()
}

const ALLOWED_UPDATE_FIELDS = new Set([
  'name',
  'enabled',
  'sourceConfig',
  'maxArtistsPerRun',
  'listenerRange',
  'cron',
  'scoreThreshold',
  'scoringWeightPreset',
  'scoringWeightOverrides',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const EMPTY_DISCOVERY_SNAPSHOT = {
  hasListenBrainz: false,
  hasSpotify: false,
  hasLastfm: false,
  hasDiscogs: false,
  hasLibrarySync: false,
}

function normalizeDiscoveryModeSourceConfig(sourceConfig: unknown): Record<string, unknown> | null {
  const config = asRecord(sourceConfig)
  if (!config) {
    return null
  }

  const modeId = typeof config.modeId === 'string' ? config.modeId.trim() : config.modeId
  return {
    ...config,
    modeId,
  }
}

function validateDiscoveryModeSourceConfig(
  sourceConfig: unknown,
  registry?: DiscoveryModeRegistry,
): { error: string | null; normalizedConfig: Record<string, unknown> | null } {
  const config = normalizeDiscoveryModeSourceConfig(sourceConfig)
  if (!config) {
    return { error: 'sourceConfig is required', normalizedConfig: null }
  }
  const modeId = typeof config.modeId === 'string' ? config.modeId : ''
  if (!modeId) {
    return { error: 'discovery-mode sourceConfig.modeId is required', normalizedConfig: null }
  }
  if (config.settingsMode !== 'easy' && config.settingsMode !== 'advanced') {
    return {
      error: 'discovery-mode sourceConfig.settingsMode must be easy or advanced',
      normalizedConfig: null,
    }
  }
  const settings = asRecord(config.settings)
  if (!settings) {
    return { error: 'discovery-mode sourceConfig.settings is required', normalizedConfig: null }
  }
  if (!registry?.get(modeId)) {
    return { error: `Unknown discovery mode '${modeId}'`, normalizedConfig: null }
  }
  return { error: null, normalizedConfig: config }
}

async function resolveDiscoveryModeSourceConfig(
  sourceConfig: unknown,
  userId: number,
  deps: AppDependencies,
): Promise<{ error: string | null; normalizedConfig: Record<string, unknown> | null }> {
  const { error, normalizedConfig } = validateDiscoveryModeSourceConfig(
    sourceConfig,
    deps.discoveryModeRegistry,
  )
  if (error || !normalizedConfig) {
    return { error, normalizedConfig }
  }

  const modeId = String(normalizedConfig.modeId)
  const snapshot = await (deps.getDiscoveryConnectionSnapshot?.(userId) ??
    Promise.resolve(EMPTY_DISCOVERY_SNAPSHOT))
  const availability = evaluateDiscoveryModeAvailability(modeId, snapshot)
  if (!availability.enabled) {
    return { error: availability.reason ?? 'This mode is unavailable.', normalizedConfig: null }
  }

  return {
    error: null,
    normalizedConfig: {
      ...normalizedConfig,
      ...buildDiscoveryModeExecutionContext(availability),
    },
  }
}

export function subscriptionRoutes(deps: AppDependencies) {
  const router = new Hono<HonoEnv>()

  router.get('/api/subscriptions/adapter-types', (c) => {
    return c.json({
      types: [
        {
          type: 'genre',
          label: 'Genre / Tag',
          configFields: [
            {
              key: 'genre',
              label: 'Genre / Tag',
              type: 'text',
              required: true,
              placeholder: 'e.g. post-rock',
            },
            {
              key: 'providers',
              label: 'Providers',
              type: 'text',
              required: false,
              placeholder: 'e.g. lastfm,musicbrainz (leave blank for all)',
            },
          ],
        },
        {
          type: 'similar',
          label: 'Similar Artists',
          configFields: [
            {
              key: 'seedArtists',
              label: 'Seed Artists',
              type: 'text',
              required: true,
              placeholder: 'e.g. Radiohead, Portishead',
            },
            {
              key: 'providers',
              label: 'Providers',
              type: 'text',
              required: false,
              placeholder: 'e.g. lastfm,listenbrainz (leave blank for all)',
            },
          ],
        },
        {
          type: 'spotify-playlist',
          label: 'Spotify Playlist',
          configFields: [
            {
              key: 'playlistId',
              label: 'Playlist ID or URL',
              type: 'text',
              required: true,
              placeholder: 'e.g. 37i9dQZEVXbMDoHDwVN2tF or open.spotify.com/playlist/...',
            },
          ],
          requiredService: 'spotify',
        },
        {
          type: 'spotify-liked-songs',
          label: 'Spotify Liked Songs',
          configFields: [],
          requiredService: 'spotify',
        },
        {
          type: 'spotify-charts',
          label: 'Spotify Charts',
          configFields: [
            {
              key: 'region',
              label: 'Region',
              type: 'select',
              required: true,
              options: [
                { value: 'global', label: 'Global' },
                { value: 'us', label: 'United States' },
                { value: 'gb', label: 'United Kingdom' },
                { value: 'de', label: 'Germany' },
                { value: 'fr', label: 'France' },
                { value: 'au', label: 'Australia' },
                { value: 'br', label: 'Brazil' },
              ],
            },
            {
              key: 'chartType',
              label: 'Chart Type',
              type: 'select',
              required: true,
              options: [
                { value: 'top50', label: 'Top 50' },
                { value: 'viral50', label: 'Viral 50 (Global only)' },
              ],
            },
          ],
          requiredService: 'spotify',
        },
        {
          type: 'lastfm-tag',
          label: 'Last.fm Tag',
          configFields: [
            { key: 'tag', label: 'Tag', type: 'text', required: true, placeholder: 'e.g. metal' },
          ],
          requiredService: 'lastfm',
        },
        {
          type: 'lastfm-charts',
          label: 'Last.fm Charts',
          configFields: [],
          requiredService: 'lastfm',
        },
        {
          type: 'listenbrainz',
          label: 'ListenBrainz',
          configFields: [
            {
              key: 'feedType',
              label: 'Feed Type',
              type: 'select',
              required: true,
              options: [
                { value: 'fresh-releases', label: 'Fresh Releases' },
                { value: 'weekly-jams', label: 'Weekly Jams' },
              ],
            },
          ],
          requiredService: 'listenbrainz',
        },
        {
          type: DISCOVERY_MODE_SUBSCRIPTION_TYPE,
          label: 'Discovery Mode',
          configFields: [],
        },
        {
          type: 'csv-import',
          label: 'CSV Import',
          configFields: [],
        },
      ],
    })
  })

  router.get('/api/subscriptions', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const subs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
    return c.json(subs)
  })

  router.post('/api/subscriptions', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const { name, sourceType, sourceProvider, sourceConfig, cron } = body as Record<string, unknown>

    if (!name || typeof name !== 'string') {
      return c.json({ error: 'name is required' }, 400)
    }
    if (!sourceType || typeof sourceType !== 'string') {
      return c.json({ error: 'sourceType is required' }, 400)
    }
    if (!sourceProvider || typeof sourceProvider !== 'string') {
      return c.json({ error: 'sourceProvider is required' }, 400)
    }
    if (!sourceConfig || typeof sourceConfig !== 'object' || Array.isArray(sourceConfig)) {
      return c.json({ error: 'sourceConfig is required' }, 400)
    }
    let normalizedSourceConfig = sourceConfig as Record<string, unknown>
    if (sourceType === DISCOVERY_MODE_SUBSCRIPTION_TYPE) {
      const { error, normalizedConfig } = await resolveDiscoveryModeSourceConfig(
        sourceConfig,
        userId,
        deps,
      )
      if (error) {
        return c.json({ error }, 400)
      }
      normalizedSourceConfig = normalizedConfig as Record<string, unknown>
    }
    if (!cron || typeof cron !== 'string') {
      return c.json({ error: 'cron is required' }, 400)
    }
    try {
      new Cron(cron, { maxRuns: 0 })
    } catch {
      return c.json({ error: 'Invalid cron expression' }, 400)
    }

    const sub = await deps.subscriptionQueries.createSubscription({
      name,
      userId,
      sourceType,
      sourceProvider,
      sourceConfig: normalizedSourceConfig,
      cron,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
      maxArtistsPerRun:
        typeof body.maxArtistsPerRun === 'number' ? body.maxArtistsPerRun : undefined,
      action: 'add_to_recommendations',
      scoreThreshold: undefined,
      listenerRange:
        body.listenerRange && typeof body.listenerRange === 'object'
          ? (body.listenerRange as { min?: number; max?: number })
          : undefined,
      scoringWeightPreset:
        typeof body.scoringWeightPreset === 'string' ? body.scoringWeightPreset : undefined,
    })

    // Auto-schedule if enabled (default is true)
    if (sub.enabled !== false) {
      deps.scheduler.schedule(`subscription-${sub.id}`, sub.cron, () =>
        deps.runSubscription(sub.id),
      )
    }

    return c.json(sub, 201)
  })

  router.post('/api/subscriptions/import/spotify-liked-songs', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const spotifyToken = await getOAuthToken(deps.db, userId, 'spotify')
    if (!spotifyToken || spotifyToken.accessToken.startsWith('pending:')) {
      return c.json({ error: 'Spotify is not connected' }, 400)
    }

    const existingSubs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
    const existing = existingSubs.find((sub) => sub.sourceType === 'spotify-liked-songs')

    const subscription =
      existing ??
      (await deps.subscriptionQueries.createSubscription({
        name: 'Spotify Liked Songs',
        userId,
        sourceType: 'spotify-liked-songs',
        sourceProvider: 'spotify',
        sourceConfig: {},
        cron: '0 6 * * 1',
        enabled: false,
        maxArtistsPerRun: 100,
        action: 'add_to_recommendations',
        scoringWeightPreset: 'default',
      }))

    deps.runSubscription(subscription.id).catch((err: unknown) => {
      console.error('Spotify liked songs import failed:', err)
    })

    return c.json(
      {
        message: 'Spotify Liked Songs import started',
        subscriptionId: subscription.id,
        created: !existing,
      },
      202,
    )
  })

  router.post('/api/subscriptions/import/csv', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.parseBody()
    const file = body.file
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded' }, 400)
    }

    const MAX_SIZE = 1_048_576 // 1MB
    if (file.size > MAX_SIZE) {
      return c.json({ error: 'File too large (max 1MB)' }, 413)
    }

    const { parseCsvArtists } = await import('@/core/subscriptions/adapters/csv-import')
    const text = await file.text()
    const artists = parseCsvArtists(text, 500)

    if (artists.length === 0) {
      return c.json({ error: 'No valid artist names found in CSV' }, 400)
    }

    const subscription = await deps.subscriptionQueries.createSubscription({
      name: `CSV Import (${artists.length} artists)`,
      userId,
      sourceType: 'csv-import',
      sourceProvider: 'csv',
      sourceConfig: { artists },
      cron: '0 0 1 1 *', // never recurs -- just a carrier for the one-shot run
      enabled: false,
      maxArtistsPerRun: artists.length,
      action: 'add_to_recommendations',
      scoringWeightPreset: 'default',
    })

    deps.runSubscription(subscription.id).catch((err: unknown) => {
      console.error('CSV import failed:', err)
    })

    const truncated = artists.length >= 500
    return c.json(
      {
        message: `Importing ${artists.length} artists${truncated ? ' (truncated to 500)' : ''}`,
        subscriptionId: subscription.id,
        artistCount: artists.length,
        truncated,
      },
      202,
    )
  })

  router.post('/api/subscriptions/import/spotify-playlist', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const rawId = String((body as Record<string, unknown>).playlistId ?? '').trim()
    if (!rawId) {
      return c.json({ error: 'playlistId is required' }, 400)
    }

    const spotifyToken = await getOAuthToken(deps.db, userId, 'spotify')
    if (!spotifyToken || spotifyToken.accessToken.startsWith('pending:')) {
      return c.json({ error: 'Spotify is not connected' }, 400)
    }

    // Normalize URL/URI to bare ID
    const playlistId = extractPlaylistId(rawId)

    const existingSubs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
    const existing = existingSubs.find(
      (sub) =>
        sub.sourceType === 'spotify-playlist' &&
        (sub.sourceConfig as Record<string, unknown>).playlistId === playlistId,
    )

    const subscription =
      existing ??
      (await deps.subscriptionQueries.createSubscription({
        name: `Spotify Playlist Import`,
        userId,
        sourceType: 'spotify-playlist',
        sourceProvider: 'spotify',
        sourceConfig: { playlistId },
        cron: '0 6 * * 1',
        enabled: false,
        maxArtistsPerRun: 100,
        action: 'add_to_recommendations',
        scoringWeightPreset: 'default',
      }))

    deps.runSubscription(subscription.id).catch((err: unknown) => {
      console.error('Spotify playlist import failed:', err)
    })

    return c.json(
      {
        message: 'Spotify playlist import started',
        subscriptionId: subscription.id,
        created: !existing,
      },
      202,
    )
  })

  router.post('/api/subscriptions/bulk-toggle', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json()
    const enabled =
      typeof (body as Record<string, unknown>).enabled === 'boolean'
        ? ((body as Record<string, unknown>).enabled as boolean)
        : null
    if (enabled === null) return c.json({ error: 'enabled (boolean) is required' }, 400)

    const subs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
    let updated = 0
    for (const sub of subs) {
      try {
        await deps.subscriptionQueries.updateSubscription(sub.id, { enabled })
        const jobName = `subscription-${sub.id}`
        if (enabled) {
          deps.scheduler.schedule(jobName, sub.cron, () => deps.runSubscription(sub.id))
        } else {
          deps.scheduler.remove(jobName)
        }
        updated++
      } catch (err: unknown) {
        console.error(`[subscriptions] Failed to toggle subscription ${sub.id}:`, err)
      }
    }
    return c.json({ updated })
  })

  router.get('/api/subscriptions/scheduler', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const jobs = deps.scheduler.listJobs()
    return c.json({ jobs })
  })

  router.patch('/api/subscriptions/:id', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const id = Number(c.req.param('id'))
    const existing = await deps.subscriptionQueries.getSubscription(id)
    if (!existing) {
      return c.json({ error: 'Subscription not found' }, 404)
    }
    if (existing.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const body = await c.req.json()
    const update: Record<string, unknown> = {}
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (Object.hasOwn(body, key)) {
        update[key] = (body as Record<string, unknown>)[key]
      }
    }
    update.action = 'add_to_recommendations'

    if (Object.hasOwn(update, 'cron') && update.cron !== undefined) {
      try {
        new Cron(update.cron as string, { maxRuns: 0 })
      } catch {
        return c.json({ error: 'Invalid cron expression' }, 400)
      }
    }

    if (
      existing.sourceType === DISCOVERY_MODE_SUBSCRIPTION_TYPE &&
      Object.hasOwn(update, 'sourceConfig')
    ) {
      const { error, normalizedConfig } = await resolveDiscoveryModeSourceConfig(
        update.sourceConfig,
        userId,
        deps,
      )
      if (error) {
        return c.json({ error }, 400)
      }
      update.sourceConfig = normalizedConfig as Record<string, unknown>
    }

    await deps.subscriptionQueries.updateSubscription(id, update)

    // Sync scheduler when cron or enabled changes
    const jobName = `subscription-${id}`
    const newEnabled = Object.hasOwn(update, 'enabled')
      ? (update.enabled as boolean)
      : existing.enabled
    const newCron = (update.cron as string | undefined) ?? existing.cron

    if (!newEnabled) {
      deps.scheduler.remove(jobName)
    } else if (Object.hasOwn(update, 'enabled') || Object.hasOwn(update, 'cron')) {
      // Re/schedule if enabled toggled on OR cron changed while enabled
      deps.scheduler.schedule(jobName, newCron, () => deps.runSubscription(id))
    }

    return c.json({ updated: true })
  })

  router.delete('/api/subscriptions/:id', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const id = Number(c.req.param('id'))
    const existing = await deps.subscriptionQueries.getSubscription(id)
    if (!existing) {
      return c.json({ error: 'Subscription not found' }, 404)
    }
    if (existing.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    await deps.subscriptionQueries.deleteSubscription(id)
    deps.scheduler.remove(`subscription-${id}`)
    return c.json({ deleted: true })
  })

  router.post('/api/subscriptions/:id/run', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const id = Number(c.req.param('id'))
    const existing = await deps.subscriptionQueries.getSubscription(id)
    if (!existing) {
      return c.json({ error: 'Subscription not found' }, 404)
    }
    if (existing.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    try {
      await deps.runSubscription(id)
    } catch (err: unknown) {
      const msg = errMsg(err)
      if (
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('spotify')
      ) {
        console.error('[subscriptions] run error:', msg)
        return c.json(
          {
            error: 'Source service is temporarily unavailable',
            service: 'spotify',
            retryable: true,
          },
          503,
        )
      }
      throw err
    }

    return c.json({ message: 'Subscription run started' }, 202)
  })

  router.get('/api/subscriptions/:id/runs', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const id = Number(c.req.param('id'))
    const existing = await deps.subscriptionQueries.getSubscription(id)
    if (!existing) {
      return c.json({ error: 'Subscription not found' }, 404)
    }
    if (existing.userId !== userId) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const runs = await deps.jobQueries.getJobsForSubscription(id)
    return c.json(runs)
  })

  return router
}
