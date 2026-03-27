import { Cron } from 'croner'
import { Hono } from 'hono'
import {
  exportPlaylistToCsv,
  exportPlaylistToJson,
  exportPlaylistToM3u,
  exportPlaylistToXspf,
  type PlaylistExportFormat,
} from '@/core/playlists/export'
import type { PlaylistScheduler } from '@/core/playlists/scheduler'
import type { Database } from '@/db'
import type { PlaylistInsert, PlaylistRow, PlaylistTrackRow } from '@/db/queries/playlists'
import {
  createPlaylist,
  deletePlaylist,
  getPlaylistsByUser,
  getPlaylistWithTracks,
  updatePlaylist,
} from '@/db/queries/playlists'
import { getSettings } from '@/db/queries/settings'
import { mergePreferences, type PlaylistConfig, type PlaylistStrategy } from '@/db/schema'
import type { HonoEnv } from '@/server/types'

export type PlaylistDeps = {
  db: Database
  playlistScheduler: PlaylistScheduler
  runPlaylistGeneration: (playlistId: number) => Promise<void>
  restartPlaylistScheduler: () => Promise<void>
}

const ALLOWED_UPDATE_FIELDS = new Set<string>([
  'name',
  'strategy',
  'targetIds',
  'schedule',
  'config',
  'enabled',
])

const PLAYLIST_EXPORT_CONTENT_TYPES: Record<PlaylistExportFormat, string> = {
  json: 'application/json',
  csv: 'text/csv',
  m3u: 'audio/x-mpegurl',
  xspf: 'application/xspf+xml',
}

const PLAYLIST_EXPORTERS: Record<
  PlaylistExportFormat,
  (args: { name: string; tracks: PlaylistTrackRow[] }) => string
> = {
  json: ({ tracks }) => exportPlaylistToJson(tracks),
  csv: ({ tracks }) => exportPlaylistToCsv(tracks),
  m3u: ({ tracks }) => exportPlaylistToM3u(tracks),
  xspf: ({ name, tracks }) => exportPlaylistToXspf(tracks, { title: name }),
}

function sanitizeFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function playlistRoutes(deps: PlaylistDeps) {
  const router = new Hono<HonoEnv>()
  const { db } = deps

  // GET /api/playlists/scheduler -- must be registered before :id route
  router.get('/api/playlists/scheduler', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const settings = await getSettings(db)
    const prefs = mergePreferences(settings?.preferences)
    const playlists = await getPlaylistsByUser(db, userId)
    const jobsByName = new Map(deps.playlistScheduler.listJobs().map((job) => [job.name, job]))
    const nextRuns = playlists
      .map((playlist) => jobsByName.get(`playlist-${playlist.id}`)?.nextRun ?? null)
      .filter((run): run is Date => run instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())
    const scheduledCrons = [
      ...new Set(
        playlists
          .map((playlist) => playlist.schedule)
          .filter((cron): cron is string => Boolean(cron)),
      ),
    ]

    return c.json({
      nextRun: nextRuns[0]?.toISOString() ?? null,
      cron: scheduledCrons.length === 1 ? scheduledCrons[0] : null,
      enabled: prefs.playlistEnabled ?? false,
    })
  })

  // GET /api/playlists
  router.get('/api/playlists', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const rows = await getPlaylistsByUser(db, userId)
    return c.json(rows)
  })

  // POST /api/playlists
  router.post('/api/playlists', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const body: Record<string, unknown> = await c.req.json()
    const { name, strategy } = body

    if (!name || typeof name !== 'string') {
      return c.json({ error: 'name is required' }, 400)
    }
    if (!strategy || typeof strategy !== 'string') {
      return c.json({ error: 'strategy is required' }, 400)
    }

    const validStrategies = ['weekly_digest', 'genre_focus', 'mood_mix', 'rediscover']
    if (!validStrategies.includes(strategy)) {
      return c.json({ error: `strategy must be one of: ${validStrategies.join(', ')}` }, 400)
    }
    if (body.schedule != null && typeof body.schedule === 'string') {
      try {
        new Cron(body.schedule, { maxRuns: 0 })
      } catch {
        return c.json({ error: 'Invalid schedule cron expression' }, 400)
      }
    }

    const data: PlaylistInsert = {
      name,
      userId,
      strategy: strategy as PlaylistStrategy,
      targetIds: Array.isArray(body.targetIds) ? (body.targetIds as number[]) : [],
      schedule: typeof body.schedule === 'string' ? body.schedule : null,
      config: body.config != null ? (body.config as PlaylistConfig) : null,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    }

    const row = await createPlaylist(db, data)
    await deps.restartPlaylistScheduler()
    return c.json(row, 201)
  })

  // GET /api/playlists/:id
  router.get('/api/playlists/:id', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const id = Number(c.req.param('id'))
    if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

    const result = await getPlaylistWithTracks(db, id)
    if (!result) return c.json({ error: 'Not found' }, 404)
    if (result.playlist.userId !== userId) return c.json({ error: 'Forbidden' }, 403)

    return c.json(result)
  })

  // GET /api/playlists/:id/export/:format
  router.get('/api/playlists/:id/export/:format', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const id = Number(c.req.param('id'))
    if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

    const format = c.req.param('format') as PlaylistExportFormat
    const exporter = PLAYLIST_EXPORTERS[format]
    const contentType = PLAYLIST_EXPORT_CONTENT_TYPES[format]
    if (!exporter || !contentType) {
      return c.json({ error: 'Unsupported format. Use json, csv, m3u, or xspf' }, 400)
    }

    const result = await getPlaylistWithTracks(db, id)
    if (!result) return c.json({ error: 'Not found' }, 404)
    if (result.playlist.userId !== userId) return c.json({ error: 'Forbidden' }, 403)

    const tracks = result.tracks.slice().sort((a, b) => a.position - b.position)
    const filename = sanitizeFilename(result.playlist.name) || `playlist-${id}`
    const body = exporter({ name: result.playlist.name, tracks })

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}.${format}"`,
      },
    })
  })

  // PATCH /api/playlists/:id
  router.patch('/api/playlists/:id', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const id = Number(c.req.param('id'))
    if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

    const existing = await getPlaylistWithTracks(db, id)
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.playlist.userId !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body: Record<string, unknown> = await c.req.json()
    const update: Record<string, unknown> = {}
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (Object.hasOwn(body, key)) {
        update[key] = body[key]
      }
    }

    if (Object.hasOwn(update, 'schedule') && update.schedule != null) {
      try {
        new Cron(String(update.schedule), { maxRuns: 0 })
      } catch {
        return c.json({ error: 'Invalid schedule cron expression' }, 400)
      }
    }

    await updatePlaylist(db, id, update)
    await deps.restartPlaylistScheduler()
    return c.json({ updated: true })
  })

  // DELETE /api/playlists/:id
  router.delete('/api/playlists/:id', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const id = Number(c.req.param('id'))
    if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

    const result = await getPlaylistWithTracks(db, id)
    if (!result) return c.json({ error: 'Not found' }, 404)
    if (result.playlist.userId !== userId) return c.json({ error: 'Forbidden' }, 403)

    await deletePlaylist(db, id)
    await deps.restartPlaylistScheduler()
    return c.json({ deleted: true })
  })

  // POST /api/playlists/:id/generate
  router.post('/api/playlists/:id/generate', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const id = Number(c.req.param('id'))
    if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

    const result = await getPlaylistWithTracks(db, id)
    if (!result) return c.json({ error: 'Not found' }, 404)
    if (result.playlist.userId !== userId) return c.json({ error: 'Forbidden' }, 403)

    // Fire-and-forget
    Promise.resolve()
      .then(() => deps.runPlaylistGeneration(id))
      .catch((err: unknown) => {
        console.error(`[playlists] Generation failed for playlist ${id}:`, err)
      })

    return c.json({ status: 'generating' }, 202)
  })

  return router
}

export type { PlaylistRow, PlaylistTrackRow }
