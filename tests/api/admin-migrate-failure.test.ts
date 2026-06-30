// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MigrationReport } from '@/core/ops/migrate-backend'
import { clearAllSessions, createSession } from '@/core/sessions'
import { createTestApp } from '../helpers/test-app'

// Keep MigrateBackendError real (the route narrows on it); stub only the
// migrateBackend call so we can drive the verification-failure (ok:false) branch
// that maps to HTTP 422 -- a branch no other test exercises.
vi.mock('@/core/ops/migrate-backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/ops/migrate-backend')>()
  return { ...actual, migrateBackend: vi.fn() }
})

const { migrateBackend } = await import('@/core/ops/migrate-backend')

const SESSION_TOKEN = 'admin-migrate-fail-session-abc'

beforeEach(async () => {
  await clearAllSessions()
  await createSession(1, SESSION_TOKEN)
  process.env.DIGARR_MIGRATE_DATA_ROOT = '/tmp/digarr-migrate-fail-root'
})

afterEach(async () => {
  await clearAllSessions()
  delete process.env.DIGARR_MIGRATE_DATA_ROOT
  vi.mocked(migrateBackend).mockReset()
})

describe('POST /api/v1/admin/migrate-backend (verification failure)', () => {
  it('returns 422 carrying the report when verification finds a content mismatch', async () => {
    const failedReport: MigrationReport = {
      ok: false,
      verified: true,
      contentVerified: false,
      targetBackend: 'pglite',
      targetDescription: 'PGlite file',
      tablesMigrated: { users: 1 },
      excludedTables: ['sessions', 'rateLimitBuckets'],
      mismatches: [{ table: 'genres', source: 1, target: 1, contentDiffers: true }],
      targetEnvHint: 'Unset DATABASE_URL/DB_HOST and set DB_PATH=/x, then restart.',
    }
    vi.mocked(migrateBackend).mockResolvedValue(failedReport)

    const { app } = createTestApp()
    const res = await app.request('/api/v1/admin/migrate-backend', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: { backend: 'pglite', path: '/tmp/digarr-migrate-fail-root/x' },
      }),
    })

    // A verification failure must NOT be reported as success, and the 422 must
    // carry the unified problem+json envelope -- never the bare MigrationReport,
    // so a 422 can only ever hold one shape. The report rides as an extension.
    expect(res.status).toBe(422)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    const body = (await res.json()) as {
      status: number
      code: string
      title: string
      report: MigrationReport
      ok?: unknown
    }
    expect(body.status).toBe(422)
    expect(body.code).toBe('migration_verify_failed')
    expect(body.ok).toBeUndefined() // top level is the problem envelope, not the report
    expect(body.report.ok).toBe(false)
    expect(body.report.mismatches[0]).toMatchObject({ table: 'genres', contentDiffers: true })
  })
})
