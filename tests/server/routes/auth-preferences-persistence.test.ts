// @vitest-environment node

import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { getOwnedAuditionTrack } from '@/db/queries/playlists'
import { createUser, getUserById, updateUser } from '@/db/queries/users'
import { artists, jobRuns, playlists, playlistTracks } from '@/db/schema'
import type { AppDependencies } from '@/server'
import { resolveUserPreferences } from '@/server/helpers/preferences'
import { authRoutes } from '@/server/routes/auth'
import type { HonoEnv } from '@/server/types'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

let db: Database
let close: () => Promise<void>

beforeAll(async () => {
  const result = await makeTestDb()
  db = result.db as unknown as Database
  close = result.close
})

afterAll(async () => {
  await close?.()
})

describe('album discovery preferences on migrated PGlite', () => {
  it('persists write-back opt-ins per user and reports only that user delivery errors', async () => {
    const owner = await createUser(db, { username: 'writeback-owner', passwordHash: 'test-hash' })
    const other = await createUser(db, { username: 'writeback-other', passwordHash: 'test-hash' })
    const app = new Hono<HonoEnv>()
    app.use('*', async (c, next) => {
      c.set('userId', owner.id)
      await next()
    })
    app.route('/', authRoutes({ db, getUserById: (id) => getUserById(db, id) } as AppDependencies))
    const patch = (body: unknown) =>
      app.request('/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect(await (await app.request('/api/v1/auth/me/preferences')).json()).toMatchObject({
      listenbrainzLoveEnabled: false,
      listenbrainzPlaylistEnabled: false,
      lastfmLoveEnabled: false,
    })
    expect(
      (await patch({ listenbrainzLoveEnabled: true, listenbrainzPlaylistEnabled: true })).status,
    ).toBe(204)
    expect((await getUserById(db, owner.id))?.preferences).toMatchObject({
      listenbrainzLoveEnabled: true,
      listenbrainzPlaylistEnabled: true,
    })
    expect((await getUserById(db, other.id))?.preferences).toBeNull()
    expect((await patch({ lastfmLoveEnabled: true })).status).toBe(400)
    expect((await patch({ listenbrainzLoveEnabled: 'true' })).status).toBe(400)
    expect((await patch({ listenbrainzLoveEnabled: false, lastfmLoveEnabled: false })).status).toBe(
      204,
    )
    await db.insert(jobRuns).values([
      {
        type: 'target',
        userId: owner.id,
        status: 'failed',
        error: 'Own delivery failed',
        metadata: { writeBackService: 'listenbrainz' },
      },
      {
        type: 'target',
        userId: other.id,
        status: 'failed',
        error: 'Other private error',
        metadata: { writeBackService: 'lastfm' },
      },
    ])
    const response = await app.request('/api/v1/auth/me/write-back')
    expect(response.status).toBe(200)
    const status = await response.json()
    expect(status).toEqual({
      listenbrainz: { configured: false, lastError: 'Own delivery failed' },
      lastfm: { configured: false, connected: false, lastError: null },
    })
    await db.insert(jobRuns).values({
      type: 'target',
      userId: owner.id,
      status: 'completed',
      metadata: { writeBackService: 'listenbrainz' },
    })
    expect(await (await app.request('/api/v1/auth/me/write-back')).json()).toMatchObject({
      listenbrainz: { lastError: null },
    })
  })

  it('resolves only the owner stored Audition track', async () => {
    const owner = await createUser(db, { username: 'audition-owner', passwordHash: 'test-hash' })
    const other = await createUser(db, { username: 'audition-other', passwordHash: 'test-hash' })
    const [audition, weekly] = await db
      .insert(playlists)
      .values([
        { userId: owner.id, name: 'Audition', strategy: 'audition' },
        { userId: owner.id, name: 'Weekly', strategy: 'weekly_digest' },
      ])
      .returning()
    if (!audition || !weekly) throw new Error('Missing fixture playlists')
    const [track, weeklyTrack] = await db
      .insert(playlistTracks)
      .values([
        { playlistId: audition.id, artistName: 'Portishead', trackName: 'Roads', position: 0 },
        { playlistId: weekly.id, artistName: 'Portishead', trackName: 'Roads', position: 0 },
      ])
      .returning()
    if (!track || !weeklyTrack) throw new Error('Missing fixture tracks')
    expect(
      await getOwnedAuditionTrack(db, owner.id, track.id, 'df523108-2308-4bb5-8972-7185bcbbbd45'),
    ).toMatchObject({ trackName: 'Roads' })
    await db
      .insert(artists)
      .values({ mbid: 'cf523108-2308-4bb5-8972-7185bcbbbd45', name: 'Portishead' })
    expect(
      await getOwnedAuditionTrack(db, owner.id, track.id, 'df523108-2308-4bb5-8972-7185bcbbbd45'),
    ).toBeNull()
    expect(
      await getOwnedAuditionTrack(db, other.id, track.id, 'df523108-2308-4bb5-8972-7185bcbbbd45'),
    ).toBeNull()
    expect(
      await getOwnedAuditionTrack(
        db,
        owner.id,
        weeklyTrack.id,
        'df523108-2308-4bb5-8972-7185bcbbbd45',
      ),
    ).toBeNull()
  })
  it.each([false, true])(
    'round-trips only the owner preferences when admin=%s',
    async (isAdmin) => {
      const owner = await createUser(db, {
        username: `owner-${isAdmin}`,
        passwordHash: 'test-hash',
      })
      await updateUser(db, owner.id, { isAdmin })
      const other = await createUser(db, {
        username: `other-${isAdmin}`,
        passwordHash: 'test-hash',
      })
      const lookup = (id: number) => getUserById(db, id)
      const app = new Hono<HonoEnv>()
      app.use('*', async (c, next) => {
        c.set('userId', owner.id)
        await next()
      })
      app.route('/', authRoutes({ db, getUserById: lookup } as AppDependencies))
      const patch = (body: unknown) =>
        app.request('/api/v1/auth/me/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      const read = async () => {
        const response = await app.request('/api/v1/auth/me/preferences')
        expect(response.status).toBe(200)
        return response.json()
      }
      const globalPreferences = { netNewAlbumDiscovery: true }

      expect(await read()).toMatchObject({ netNewAlbumDiscovery: false })
      expect(await resolveUserPreferences(lookup, globalPreferences, owner.id)).toEqual(
        globalPreferences,
      )
      expect((await patch({ netNewAlbumDiscovery: true })).status).toBe(204)
      expect(await read()).toMatchObject({ netNewAlbumDiscovery: true })
      expect((await lookup(owner.id))?.preferences).toEqual({ netNewAlbumDiscovery: true })

      expect((await patch({ scoreThreshold: 0.75, ignoredPreference: true })).status).toBe(204)
      expect(await read()).toMatchObject({ netNewAlbumDiscovery: true, scoreThreshold: 0.75 })
      expect((await patch({ netNewAlbumDiscovery: false })).status).toBe(204)
      expect(await read()).toMatchObject({ netNewAlbumDiscovery: false, scoreThreshold: 0.75 })
      expect(await resolveUserPreferences(lookup, globalPreferences, owner.id)).toEqual({
        netNewAlbumDiscovery: false,
        scoreThreshold: 0.75,
      })

      const stored = (await lookup(owner.id))?.preferences
      for (const value of ['true', 'false', 1, 0, null, [], {}]) {
        expect((await patch({ netNewAlbumDiscovery: value, scoreThreshold: 0.9 })).status).toBe(400)
        expect((await lookup(owner.id))?.preferences).toEqual(stored)
      }
      expect((await lookup(other.id))?.preferences).toBeNull()
      expect(await resolveUserPreferences(lookup, globalPreferences, other.id)).toEqual(
        globalPreferences,
      )
    },
  )
})
