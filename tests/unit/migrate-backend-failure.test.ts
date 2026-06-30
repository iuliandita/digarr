import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

// PGlite WASM cold-start + migrations can exceed the 5s default under full-suite
// parallel contention; these failure paths still spin up a real target.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

// Keep createBackup + BACKUP_TABLE_BY_KEY real (the verification loop and the
// source snapshot rely on them); override only restoreBackup so we can simulate
// a target that diverges from the source after the copy, or a restore that
// blows up mid-flight.
vi.mock('@/core/ops/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/ops/backup')>()
  return { ...actual, restoreBackup: vi.fn() }
})

const { migrateBackend } = await import('@/core/ops/migrate-backend')
const { restoreBackup } = await import('@/core/ops/backup')

function tgt(name: string) {
  return join(process.env.DIGARR_MIGRATE_DATA_ROOT as string, name)
}

describe('migrateBackend failure paths', () => {
  beforeEach(() => {
    process.env.DIGARR_MIGRATE_DATA_ROOT = mkdtempSync(join(tmpdir(), 'digarr-migfail-'))
    vi.mocked(restoreBackup).mockReset()
  })
  afterEach(() => {
    delete process.env.DIGARR_MIGRATE_DATA_ROOT
  })

  it('reports ok:false with mismatches when the target is missing rows after restore', async () => {
    const src = await makeTestDb()
    try {
      await src.db.insert(schema.users).values({ username: 'mig', passwordHash: 'x' })
      await src.db
        .insert(schema.genres)
        .values({ name: 'Synthwave', slug: 'synthwave', source: 'manual' })

      // No-op restore: the freshly created target stays empty, so the post-copy
      // verification must detect the row-count mismatch and refuse to claim success.
      vi.mocked(restoreBackup).mockResolvedValue({
        tablesRestored: {},
        warnings: [],
        encryptionMismatch: false,
        affectedEncryptedFields: [],
      })

      const report = await migrateBackend({
        sourceDb: src.db as never,
        target: { backend: 'pglite', path: tgt('mismatch') },
        isPipelineRunning: () => false,
      })

      expect(report.ok).toBe(false)
      expect(report.verified).toBe(false)
      expect(report.contentVerified).toBe(false)
      expect(report.mismatches.length).toBeGreaterThan(0)
      const users = report.mismatches.find((m) => m.table === 'users')
      expect(users).toMatchObject({ source: 1, target: 0 })
    } finally {
      await src.close()
    }
  })

  it('rejects (no silent ok:true) when restoreBackup throws mid-restore', async () => {
    const src = await makeTestDb()
    try {
      await src.db.insert(schema.users).values({ username: 'mig', passwordHash: 'x' })
      vi.mocked(restoreBackup).mockRejectedValue(new Error('constraint violation mid-restore'))

      await expect(
        migrateBackend({
          sourceDb: src.db as never,
          target: { backend: 'pglite', path: tgt('throw') },
          isPipelineRunning: () => false,
        }),
      ).rejects.toThrow(/constraint violation mid-restore/)
    } finally {
      await src.close()
    }
  })
})
