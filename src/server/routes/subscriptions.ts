import { Hono } from 'hono'
import { createDeezerUserClient } from '@/core/clients/deezer-user'
import { resolveDeezerToken } from '@/core/deezer-auth'
import {
  buildDiscoveryModeExecutionContext,
  evaluateDiscoveryModeAvailability,
} from '@/core/discovery-modes/availability'
import type { DiscoveryModeRegistry } from '@/core/discovery-modes/registry'
import { DISCOVERY_MODE_SUBSCRIPTION_TYPE } from '@/core/subscriptions/registry'
import { errMsg } from '@/core/validation'
import { getOAuthToken } from '@/db/queries/oauth-tokens'
import type { AppDependencies } from '@/server'
import { notAuthenticated } from '@/server/helpers/auth-problems'
import { readPagination } from '@/server/helpers/pagination'
import { encodeCursor } from '@/server/helpers/pagination-cursor'
import { parsePositiveIntParam } from '@/server/helpers/parse-int-clamp'
import { problem } from '@/server/helpers/problem'
import { resolveRequestMessages } from '@/server/locale'
import {
  bulkToggleSchema,
  createSubscriptionSchema,
  deezerPlaylistImportSchema,
  spotifyPlaylistImportSchema,
  subscriptionIdParamSchema,
  updateSubscriptionSchema,
} from '@/server/schemas/subscriptions'
import { zJson, zParam } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

/** Extract the bare playlist ID from a URL, URI, or raw ID. */
function extractPlaylistId(raw: string): string {
  const uriMatch = raw.match(/spotify:playlist:([A-Za-z0-9]+)/)
  if (uriMatch?.[1]) return uriMatch[1]
  const urlMatch = raw.match(/\/playlist\/([A-Za-z0-9]+)/)
  if (urlMatch?.[1]) return urlMatch[1]
  return raw.trim()
}

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

  router.get('/api/v1/subscriptions/adapter-types', (c) => {
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

  router.get('/api/v1/subscriptions', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }
    const page = readPagination(c)
    if (page === null) {
      const subs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
      return c.json(subs)
    }
    const rows = await deps.subscriptionQueries.getSubscriptionsByUser(userId, {
      limit: page.limit + 1,
      cursor: page.cursor,
    })
    const hasMore = rows.length > page.limit
    const data = hasMore ? rows.slice(0, page.limit) : rows
    const last = data[data.length - 1]
    const nextCursor =
      hasMore && last ? encodeCursor({ id: last.id, ts: last.createdAt.toISOString() }) : null
    return c.json({ data, meta: { limit: page.limit, nextCursor } })
  })

  router.post('/api/v1/subscriptions', zJson(createSubscriptionSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }

    const body = c.req.valid('json')
    let normalizedSourceConfig = body.sourceConfig
    if (body.sourceType === DISCOVERY_MODE_SUBSCRIPTION_TYPE) {
      const { error, normalizedConfig } = await resolveDiscoveryModeSourceConfig(
        body.sourceConfig,
        userId,
        deps,
      )
      if (error) {
        return c.json({ error }, 400)
      }
      normalizedSourceConfig = normalizedConfig as Record<string, unknown>
    }

    const sub = await deps.subscriptionQueries.createSubscription({
      name: body.name,
      userId,
      sourceType: body.sourceType,
      sourceProvider: body.sourceProvider,
      sourceConfig: normalizedSourceConfig,
      cron: body.cron,
      enabled: body.enabled ?? true,
      maxArtistsPerRun: body.maxArtistsPerRun,
      action: 'add_to_recommendations',
      scoreThreshold: undefined,
      listenerRange: body.listenerRange,
      scoringWeightPreset: body.scoringWeightPreset,
    })

    // Auto-schedule if enabled (default is true)
    if (sub.enabled !== false) {
      deps.scheduler.schedule(`subscription-${sub.id}`, sub.cron, () =>
        deps.runSubscription(sub.id),
      )
    }

    return c.json(sub, 201)
  })

  router.post('/api/v1/subscriptions/import/spotify-liked-songs', async (c) => {
    const messages = resolveRequestMessages({
      requestLocale: c.req.header('X-Digarr-Locale'),
      acceptLanguage: c.req.header('Accept-Language'),
    })
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ error: messages['common.unauthorized'] }, 401)
    }

    const spotifyToken = await getOAuthToken(deps.db, userId, 'spotify')
    if (!spotifyToken || spotifyToken.accessToken.startsWith('pending:')) {
      return c.json({ error: messages['subscriptions.spotifyNotConnected'] }, 400)
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

  router.post('/api/v1/subscriptions/import/csv', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
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
      cron: '0 0 1 1 *', // never recurs - just a carrier for the one-shot run
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

  router.post(
    '/api/v1/subscriptions/import/spotify-playlist',
    zJson(spotifyPlaylistImportSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) {
        return notAuthenticated(c)
      }

      const { playlistId: rawId } = c.req.valid('json')

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
    },
  )

  router.post('/api/v1/subscriptions/import/deezer-favorites', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }

    const deezerToken = await getOAuthToken(deps.db, userId, 'deezer')
    if (!deezerToken || deezerToken.accessToken.startsWith('pending:')) {
      return c.json({ error: 'Deezer is not connected' }, 400)
    }

    const existingSubs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
    const existing = existingSubs.find(
      (sub) =>
        sub.sourceType === 'deezer' &&
        (sub.sourceConfig as Record<string, unknown>).feedType === 'favorites',
    )

    const subscription =
      existing ??
      (await deps.subscriptionQueries.createSubscription({
        name: 'Deezer Favorites',
        userId,
        sourceType: 'deezer',
        sourceProvider: 'deezer',
        sourceConfig: { feedType: 'favorites' },
        cron: '0 6 * * 1',
        enabled: false,
        maxArtistsPerRun: 100,
        action: 'add_to_recommendations',
        scoringWeightPreset: 'default',
      }))

    deps.runSubscription(subscription.id).catch((err: unknown) => {
      console.error('Deezer favorites import failed:', err)
    })

    return c.json(
      {
        message: 'Deezer Favorites import started',
        subscriptionId: subscription.id,
        created: !existing,
      },
      202,
    )
  })

  router.post('/api/v1/subscriptions/import/deezer-followed', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }

    const deezerToken = await getOAuthToken(deps.db, userId, 'deezer')
    if (!deezerToken || deezerToken.accessToken.startsWith('pending:')) {
      return c.json({ error: 'Deezer is not connected' }, 400)
    }

    const existingSubs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
    const existing = existingSubs.find(
      (sub) =>
        sub.sourceType === 'deezer' &&
        (sub.sourceConfig as Record<string, unknown>).feedType === 'followed',
    )

    const subscription =
      existing ??
      (await deps.subscriptionQueries.createSubscription({
        name: 'Deezer Followed Artists',
        userId,
        sourceType: 'deezer',
        sourceProvider: 'deezer',
        sourceConfig: { feedType: 'followed' },
        cron: '0 6 * * 1',
        enabled: false,
        maxArtistsPerRun: 100,
        action: 'add_to_recommendations',
        scoringWeightPreset: 'default',
      }))

    deps.runSubscription(subscription.id).catch((err: unknown) => {
      console.error('Deezer followed artists import failed:', err)
    })

    return c.json(
      {
        message: 'Deezer Followed Artists import started',
        subscriptionId: subscription.id,
        created: !existing,
      },
      202,
    )
  })

  router.get('/api/v1/subscriptions/import/deezer-playlists', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }

    let accessToken: string
    try {
      accessToken = await resolveDeezerToken(deps.db, userId)
    } catch {
      return c.json({ error: 'Deezer is not connected' }, 400)
    }
    const client = createDeezerUserClient(accessToken)
    const playlists = await client.getPlaylists()

    return c.json({ playlists })
  })

  router.post(
    '/api/v1/subscriptions/import/deezer-playlists',
    zJson(deezerPlaylistImportSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) {
        return notAuthenticated(c)
      }

      const deezerToken = await getOAuthToken(deps.db, userId, 'deezer')
      if (!deezerToken || deezerToken.accessToken.startsWith('pending:')) {
        return c.json({ error: 'Deezer is not connected' }, 400)
      }

      const { playlistIds } = c.req.valid('json')

      const existingSubs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
      const playlistIdsStr = playlistIds.map((v) => String(v)).join(',')
      const existing = existingSubs.find(
        (sub) =>
          sub.sourceType === 'deezer' &&
          (sub.sourceConfig as Record<string, unknown>).feedType === 'playlists' &&
          (sub.sourceConfig as Record<string, unknown>).playlistIds === playlistIdsStr,
      )

      const subscription =
        existing ??
        (await deps.subscriptionQueries.createSubscription({
          name: 'Deezer Playlist Import',
          userId,
          sourceType: 'deezer',
          sourceProvider: 'deezer',
          sourceConfig: { feedType: 'playlists', playlistIds: playlistIdsStr },
          cron: '0 6 * * 1',
          enabled: false,
          maxArtistsPerRun: 100,
          action: 'add_to_recommendations',
          scoringWeightPreset: 'default',
        }))

      deps.runSubscription(subscription.id).catch((err: unknown) => {
        console.error('Deezer playlist import failed:', err)
      })

      return c.json(
        {
          message: 'Deezer Playlist import started',
          subscriptionId: subscription.id,
          created: !existing,
        },
        202,
      )
    },
  )

  router.post('/api/v1/subscriptions/bulk-toggle', zJson(bulkToggleSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return notAuthenticated(c)

    const { enabled } = c.req.valid('json')

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

  router.get('/api/v1/subscriptions/scheduler', async (c) => {
    const userId = c.get('userId')
    if (!userId) return notAuthenticated(c)

    const jobs = deps.scheduler.listJobs()
    const subs = await deps.subscriptionQueries.getSubscriptionsByUser(userId)
    const ownedIds = new Set(subs.map((s) => String(s.id)))
    const filtered = jobs.filter((j) => {
      const m = j.name.match(/^subscription-(\d+)$/)
      return m?.[1] ? ownedIds.has(m[1]) : false
    })
    return c.json({ jobs: filtered })
  })

  router.patch(
    '/api/v1/subscriptions/:id',
    zParam(subscriptionIdParamSchema),
    zJson(updateSubscriptionSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) {
        return notAuthenticated(c)
      }

      const { id } = c.req.valid('param')
      const existing = await deps.subscriptionQueries.getSubscription(id)
      if (!existing) {
        return problem(
          c,
          'subscription-not-found',
          'Subscription not found',
          404,
          undefined,
          undefined,
          'errors.subscription.notFound',
        )
      }
      if (existing.userId !== userId) {
        return problem(
          c,
          'subscription-not-found',
          'Subscription not found',
          404,
          undefined,
          undefined,
          'errors.subscription.notFound',
        )
      }

      const body = c.req.valid('json')
      const update: Record<string, unknown> = { ...body, action: 'add_to_recommendations' }

      if (
        existing.sourceType === DISCOVERY_MODE_SUBSCRIPTION_TYPE &&
        update.sourceConfig !== undefined
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

      return c.body(null, 204)
    },
  )

  router.delete('/api/v1/subscriptions/:id', zParam(subscriptionIdParamSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }
    const { id } = c.req.valid('param')
    const existing = await deps.subscriptionQueries.getSubscription(id)
    if (!existing) {
      return problem(
        c,
        'subscription-not-found',
        'Subscription not found',
        404,
        undefined,
        undefined,
        'errors.subscription.notFound',
      )
    }
    if (existing.userId !== userId) {
      return problem(
        c,
        'subscription-not-found',
        'Subscription not found',
        404,
        undefined,
        undefined,
        'errors.subscription.notFound',
      )
    }
    await deps.subscriptionQueries.deleteSubscription(id)
    deps.scheduler.remove(`subscription-${id}`)
    return c.body(null, 204)
  })

  router.post('/api/v1/subscriptions/:id/run', zParam(subscriptionIdParamSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }

    const { id } = c.req.valid('param')
    const existing = await deps.subscriptionQueries.getSubscription(id)
    if (!existing) {
      return problem(
        c,
        'subscription-not-found',
        'Subscription not found',
        404,
        undefined,
        undefined,
        'errors.subscription.notFound',
      )
    }
    if (existing.userId !== userId) {
      return problem(
        c,
        'subscription-not-found',
        'Subscription not found',
        404,
        undefined,
        undefined,
        'errors.subscription.notFound',
      )
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

  router.get('/api/v1/subscriptions/:id/runs', async (c) => {
    const userId = c.get('userId')
    if (!userId) {
      return notAuthenticated(c)
    }

    const id = parsePositiveIntParam(c.req.param('id'))
    if (id == null) return c.json({ error: 'Invalid subscription ID' }, 400)
    const existing = await deps.subscriptionQueries.getSubscription(id)
    if (!existing) {
      return problem(
        c,
        'subscription-not-found',
        'Subscription not found',
        404,
        undefined,
        undefined,
        'errors.subscription.notFound',
      )
    }
    if (existing.userId !== userId) {
      return problem(
        c,
        'subscription-not-found',
        'Subscription not found',
        404,
        undefined,
        undefined,
        'errors.subscription.notFound',
      )
    }

    const runs = await deps.jobQueries.getJobsForSubscription(id)
    return c.json(runs)
  })

  return router
}
