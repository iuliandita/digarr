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
import { mergePreferences, type PlaylistConfig } from '@/db/schema'
import { readPagination } from '@/server/helpers/pagination'
import { encodeCursor } from '@/server/helpers/pagination-cursor'
import { problem } from '@/server/helpers/problem'
import {
  createPlaylistSchema,
  playlistExportFormatParamSchema,
  playlistIdParamSchema,
  updatePlaylistSchema,
} from '@/server/schemas/playlists'
import { zJson, zParam } from '@/server/schemas/validator'
import type { HonoEnv } from '@/server/types'

export type PlaylistDeps = {
  db: Database
  playlistScheduler: PlaylistScheduler
  runPlaylistGeneration: (playlistId: number) => Promise<void>
  restartPlaylistScheduler: () => Promise<void>
}

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

  // GET /api/v1/playlists/scheduler - must be registered before :id route
  router.get('/api/v1/playlists/scheduler', async (c) => {
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

  // GET /api/v1/playlists
  router.get('/api/v1/playlists', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const page = readPagination(c)
    if (page === null) {
      const rows = await getPlaylistsByUser(db, userId)
      return c.json(rows)
    }
    const rows = await getPlaylistsByUser(db, userId, {
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

  // POST /api/v1/playlists
  router.post('/api/v1/playlists', zJson(createPlaylistSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const body = c.req.valid('json')
    const data: PlaylistInsert = {
      name: body.name,
      userId,
      strategy: body.strategy,
      targetIds: body.targetIds ?? [],
      schedule: body.schedule ?? null,
      config: (body.config ?? null) as PlaylistConfig | null,
      enabled: body.enabled ?? true,
    }

    const row = await createPlaylist(db, data)
    await deps.restartPlaylistScheduler()
    return c.json(row, 201)
  })

  // GET /api/v1/playlists/:id
  router.get('/api/v1/playlists/:id', zParam(playlistIdParamSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const { id } = c.req.valid('param')

    const result = await getPlaylistWithTracks(db, id)
    if (!result)
      return problem(
        c,
        'playlist-not-found',
        'Playlist not found',
        404,
        undefined,
        undefined,
        'errors.playlist.notFound',
      )
    if (result.playlist.userId !== userId)
      return problem(
        c,
        'playlist-not-found',
        'Playlist not found',
        404,
        undefined,
        undefined,
        'errors.playlist.notFound',
      )

    return c.json(result)
  })

  // GET /api/v1/playlists/:id/export/:format
  router.get(
    '/api/v1/playlists/:id/export/:format',
    zParam(playlistExportFormatParamSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) return c.json({ error: 'Unauthorized' }, 401)

      const { id, format } = c.req.valid('param')
      const exporter = PLAYLIST_EXPORTERS[format]
      const contentType = PLAYLIST_EXPORT_CONTENT_TYPES[format]

      const result = await getPlaylistWithTracks(db, id)
      if (!result)
        return problem(
          c,
          'playlist-not-found',
          'Playlist not found',
          404,
          undefined,
          undefined,
          'errors.playlist.notFound',
        )
      if (result.playlist.userId !== userId)
        return problem(
          c,
          'playlist-not-found',
          'Playlist not found',
          404,
          undefined,
          undefined,
          'errors.playlist.notFound',
        )

      const tracks = result.tracks.slice().sort((a, b) => a.position - b.position)
      const filename = sanitizeFilename(result.playlist.name) || `playlist-${id}`
      const body = exporter({ name: result.playlist.name, tracks })

      return new Response(body, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}.${format}"`,
        },
      })
    },
  )

  // PATCH /api/v1/playlists/:id
  router.patch(
    '/api/v1/playlists/:id',
    zParam(playlistIdParamSchema),
    zJson(updatePlaylistSchema),
    async (c) => {
      const userId = c.get('userId')
      if (!userId) return c.json({ error: 'Unauthorized' }, 401)

      const { id } = c.req.valid('param')
      const existing = await getPlaylistWithTracks(db, id)
      if (!existing)
        return problem(
          c,
          'playlist-not-found',
          'Playlist not found',
          404,
          undefined,
          undefined,
          'errors.playlist.notFound',
        )
      if (existing.playlist.userId !== userId)
        return problem(
          c,
          'playlist-not-found',
          'Playlist not found',
          404,
          undefined,
          undefined,
          'errors.playlist.notFound',
        )

      const body = c.req.valid('json')
      await updatePlaylist(db, id, body as Record<string, unknown>)
      await deps.restartPlaylistScheduler()
      return c.body(null, 204)
    },
  )

  // DELETE /api/v1/playlists/:id
  router.delete('/api/v1/playlists/:id', zParam(playlistIdParamSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const { id } = c.req.valid('param')

    const result = await getPlaylistWithTracks(db, id)
    if (!result)
      return problem(
        c,
        'playlist-not-found',
        'Playlist not found',
        404,
        undefined,
        undefined,
        'errors.playlist.notFound',
      )
    if (result.playlist.userId !== userId)
      return problem(
        c,
        'playlist-not-found',
        'Playlist not found',
        404,
        undefined,
        undefined,
        'errors.playlist.notFound',
      )

    await deletePlaylist(db, id)
    await deps.restartPlaylistScheduler()
    return c.body(null, 204)
  })

  // POST /api/v1/playlists/:id/generate
  router.post('/api/v1/playlists/:id/generate', zParam(playlistIdParamSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const { id } = c.req.valid('param')

    const result = await getPlaylistWithTracks(db, id)
    if (!result)
      return problem(
        c,
        'playlist-not-found',
        'Playlist not found',
        404,
        undefined,
        undefined,
        'errors.playlist.notFound',
      )
    if (result.playlist.userId !== userId)
      return problem(
        c,
        'playlist-not-found',
        'Playlist not found',
        404,
        undefined,
        undefined,
        'errors.playlist.notFound',
      )

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
