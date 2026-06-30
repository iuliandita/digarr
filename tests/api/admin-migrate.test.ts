// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import * as schema from '@/db/schema'
import type { AppDependencies } from '@/server'
import { createTestApp } from '../helpers/test-app'
import { makeTestDb } from '../helpers/test-db'

const SESSION_TOKEN = 'admin-migrate-test-session-abc'
let tmpDir: string

beforeEach(async () => {
  await clearAllSessions()
  await createSession(1, SESSION_TOKEN)
  tmpDir = await mkdtemp(join(tmpdir(), 'digarr-migrate-test-'))
  process.env.DIGARR_MIGRATE_DATA_ROOT = tmpDir
})

afterEach(async () => {
  await clearAllSessions()
  delete process.env.DIGARR_MIGRATE_DATA_ROOT
  await rm(tmpDir, { recursive: true, force: true })
})

function nonAdminGetUser(): AppDependencies['getUserById'] {
  return vi.fn(async () => ({
    id: 1,
    username: 'user',
    isAdmin: false,
    preferredLocale: null,
  })) as unknown as AppDependencies['getUserById']
}

describe('POST /api/v1/admin/migrate-backend/test', () => {
  it('returns 403 for non-admin users', async () => {
    const { app } = createTestApp({ getUserById: nonAdminGetUser() })
    const res = await app.request('/api/v1/admin/migrate-backend/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'pglite', path: `${tmpDir}/db` }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 for missing backend discriminant', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/admin/migrate-backend/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBeTruthy()
  })

  it('returns 400 for invalid backend value', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/admin/migrate-backend/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'mysql', host: 'localhost' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for unparseable body', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/admin/migrate-backend/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 200 ok:true for valid pglite path within data root', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/admin/migrate-backend/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'pglite', path: `${tmpDir}/db` }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.backend).toBe('pglite')
    expect(typeof body.description).toBe('string')
  })

  it('returns 502 for pglite path outside data root', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/admin/migrate-backend/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'pglite', path: '/etc/digarr-outside-root' }),
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })
})

describe('POST /api/v1/admin/migrate-backend', () => {
  it('returns 403 for non-admin users', async () => {
    const { app } = createTestApp({ getUserById: nonAdminGetUser() })
    const res = await app.request('/api/v1/admin/migrate-backend', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: { backend: 'pglite', path: `${tmpDir}/db` } }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 for missing target', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/admin/migrate-backend', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBeTruthy()
  })

  it('returns 400 for unparseable body', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/v1/admin/migrate-backend', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 409 when pipeline is running', async () => {
    const { app, deps } = createTestApp()
    Object.assign(deps.orchestrator, { isRunning: true })
    const res = await app.request('/api/v1/admin/migrate-backend', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: { backend: 'pglite', path: `${tmpDir}/db` } }),
    })
    Object.assign(deps.orchestrator, { isRunning: false })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('pipeline_running')
  })

  it('returns 200 with a DB_PATH env hint on a successful migration', async () => {
    // Inject a real migrated source DB; the default test deps.db is a stub.
    const src = await makeTestDb()
    try {
      const { app } = createTestApp({ db: src.db as unknown as AppDependencies['db'] })
      const res = await app.request('/api/v1/admin/migrate-backend', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: { backend: 'pglite', path: `${tmpDir}/migrated` } }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.ok).toBe(true)
      expect(body.targetEnvHint as string).toContain('DB_PATH=')
    } finally {
      await src.close()
    }
  }, 30_000)

  it('returns 409 target_not_empty when the target already holds data', async () => {
    const src = await makeTestDb()
    try {
      // The emptiness guard keys on the users table, so the source must have a user
      // for the first migration to leave the target non-empty.
      await src.db.insert(schema.users).values({ username: 'seed', passwordHash: 'x' })
      const { app } = createTestApp({ db: src.db as unknown as AppDependencies['db'] })
      const target = { backend: 'pglite' as const, path: `${tmpDir}/reuse` }
      const headers = {
        Authorization: `Bearer ${SESSION_TOKEN}`,
        'Content-Type': 'application/json',
      }
      const first = await app.request('/api/v1/admin/migrate-backend', {
        method: 'POST',
        headers,
        body: JSON.stringify({ target }),
      })
      expect(first.status).toBe(200)
      // Second migration into the now-populated target without overwrite must be a
      // typed precondition failure (409), not an opaque 500.
      const second = await app.request('/api/v1/admin/migrate-backend', {
        method: 'POST',
        headers,
        body: JSON.stringify({ target }),
      })
      expect(second.status).toBe(409)
      const body = (await second.json()) as Record<string, unknown>
      expect(body.code).toBe('target_not_empty')
    } finally {
      await src.close()
    }
  }, 30_000)
})
