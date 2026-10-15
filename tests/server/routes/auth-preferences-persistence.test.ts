// @vitest-environment node

import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { createUser, getUserById, updateUser } from '@/db/queries/users'
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
