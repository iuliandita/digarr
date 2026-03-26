import { Cron } from 'croner'
import { Hono } from 'hono'
import type { AppDependencies } from '@/server'
import type { HonoEnv } from '@/server/types'

const LISTENBRAINZ_SIMILAR_ERROR =
  'ListenBrainz similar-artist lookups are currently unavailable. Add Last.fm or choose a different subscription type.'

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

function normalizeProviders(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function resolveSubscriptionProviders(
  sourceConfig: Record<string, unknown>,
  sourceProvider?: string,
): string[] {
  const fromConfig = normalizeProviders(sourceConfig.providers)
  const resolved = fromConfig.length > 0 ? fromConfig : normalizeProviders(sourceProvider)
  return [...new Set(resolved)]
}

function getUnsupportedSimilarProviderError(
  sourceType: string,
  sourceConfig: Record<string, unknown>,
  sourceProvider?: string,
): string | null {
  if (sourceType !== 'similar') {
    return null
  }

  const providers = resolveSubscriptionProviders(sourceConfig, sourceProvider)
  return providers.length === 1 && providers[0] === 'listenbrainz'
    ? LISTENBRAINZ_SIMILAR_ERROR
    : null
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
    if (!cron || typeof cron !== 'string') {
      return c.json({ error: 'cron is required' }, 400)
    }
    const unsupportedProviderError = getUnsupportedSimilarProviderError(
      sourceType,
      sourceConfig as Record<string, unknown>,
      sourceProvider,
    )
    if (unsupportedProviderError) {
      return c.json({ error: unsupportedProviderError }, 400)
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
      sourceConfig: sourceConfig as Record<string, unknown>,
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
    const nextSourceConfig =
      Object.hasOwn(update, 'sourceConfig') &&
      update.sourceConfig &&
      typeof update.sourceConfig === 'object' &&
      !Array.isArray(update.sourceConfig)
        ? (update.sourceConfig as Record<string, unknown>)
        : (existing.sourceConfig as Record<string, unknown>)
    const unsupportedProviderError = getUnsupportedSimilarProviderError(
      existing.sourceType,
      nextSourceConfig,
      existing.sourceProvider,
    )
    if (unsupportedProviderError) {
      return c.json({ error: unsupportedProviderError }, 400)
    }

    if (Object.hasOwn(update, 'cron') && update.cron !== undefined) {
      try {
        new Cron(update.cron as string, { maxRuns: 0 })
      } catch {
        return c.json({ error: 'Invalid cron expression' }, 400)
      }
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

    // Fire-and-forget
    Promise.resolve()
      .then(() => deps.runSubscription(id))
      .catch((err: unknown) => {
        console.error(`Manual subscription run failed (id=${id}):`, err)
      })

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

    const runs = await deps.subscriptionQueries.getRunsForSubscription(id)
    return c.json(runs)
  })

  return router
}
