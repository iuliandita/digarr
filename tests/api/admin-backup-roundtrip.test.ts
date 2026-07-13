// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import * as schema from '@/db/schema'
import { createTestApp } from '../helpers/test-app'
import { makeTestDb } from '../helpers/test-db'

const SESSION_TOKEN = 'admin-backup-roundtrip-session'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

beforeEach(async () => {
  await clearAllSessions()
  await createSession(1, SESSION_TOKEN)
})

afterEach(async () => {
  await clearAllSessions()
})

describe('admin cache backup round trip', () => {
  it('backs up and restores verified artist genre aliases', async () => {
    const { db, close } = await makeTestDb()
    try {
      const mbid = '00000000-0000-0000-0000-000000000051'
      await db.insert(schema.artists).values({
        mbid,
        name: 'Round Trip',
        genres: ['ambient'],
        genresCachedAt: new Date(),
      })
      await db.insert(schema.artistGenreAliases).values({
        source: 'subsonic',
        nameNormalized: 'round trip',
        mbid,
      })
      const { app } = createTestApp({ db: db as never })

      const backupResponse = await app.request('/api/v1/admin/backup?includeCaches=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
      })
      expect(backupResponse.status).toBe(200)
      const backup = (await backupResponse.json()) as {
        data: { artistGenreAliases?: unknown[] }
      }
      expect(backup.data.artistGenreAliases).toHaveLength(1)

      const restoreResponse = await app.request('/api/v1/admin/restore?confirm=true&force=true', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SESSION_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(backup),
      })

      expect(restoreResponse.status).toBe(200)
      const aliases = await db.select().from(schema.artistGenreAliases)
      expect(aliases).toHaveLength(1)
    } finally {
      await close()
    }
  })
})
