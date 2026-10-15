import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

// PGlite WASM cold-start + migrations can exceed the 5s default under full-suite
// parallel contention; these failure paths still spin up a real target.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

const copyDatabaseTables = vi.hoisted(() => vi.fn())

vi.mock('@/core/ops/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/ops/backup')>()
  return {
    ...actual,
    assertDatabaseCopyTargetEmpty: vi.fn(actual.assertDatabaseCopyTargetEmpty),
    copyDatabaseTables,
    createBackup: vi.fn(actual.createBackup),
    restoreBackup: vi.fn(actual.restoreBackup),
  }
})

const { migrateBackend } = await import('@/core/ops/migrate-backend')
const {
  assertDatabaseCopyTargetEmpty,
  createBackup,
  DatabaseCopyTargetNotEmptyError,
  restoreBackup,
} = await import('@/core/ops/backup')

function tgt(name: string) {
  return join(process.env.DIGARR_MIGRATE_DATA_ROOT as string, name)
}

describe('migrateBackend failure paths', () => {
  beforeEach(() => {
    process.env.DIGARR_MIGRATE_DATA_ROOT = mkdtempSync(join(tmpdir(), 'digarr-migfail-'))
    copyDatabaseTables.mockReset()
    vi.mocked(assertDatabaseCopyTargetEmpty).mockClear()
    vi.mocked(createBackup).mockClear()
    vi.mocked(restoreBackup).mockClear()
  })
  afterEach(() => {
    delete process.env.DIGARR_MIGRATE_DATA_ROOT
  })

  it.each([false, true])(
    'delegates a repeatable-read, read-only copy with overwrite=%s',
    async (overwrite) => {
      const src = await makeTestDb()
      try {
        await src.db.insert(schema.users).values({ username: 'mig', passwordHash: 'x' })
        copyDatabaseTables.mockImplementation(async (sourceTx) => {
          const isolation = await sourceTx.execute(sql`show transaction_isolation`)
          const readOnly = await sourceTx.execute(sql`show transaction_read_only`)
          expect(
            (isolation as unknown as { rows: { transaction_isolation: string }[] }).rows[0]
              ?.transaction_isolation,
          ).toBe('repeatable read')
          expect(
            (readOnly as unknown as { rows: { transaction_read_only: string }[] }).rows[0]
              ?.transaction_read_only,
          ).toBe('on')
          return { tablesRestored: { users: 1 }, mismatches: [] }
        })

        const report = await migrateBackend({
          sourceDb: src.db as never,
          target: { backend: 'pglite', path: tgt('delegated') },
          isPipelineRunning: () => false,
          overwrite,
        })

        expect(copyDatabaseTables).toHaveBeenCalledOnce()
        expect(copyDatabaseTables).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
          requireEmptyTarget: !overwrite,
        })
        expect(assertDatabaseCopyTargetEmpty).toHaveBeenCalledTimes(overwrite ? 0 : 1)
        expect(createBackup).not.toHaveBeenCalled()
        expect(restoreBackup).not.toHaveBeenCalled()
        expect(report.tablesMigrated).toEqual({ users: 1 })
        expect(report.verified).toBe(true)
      } finally {
        await src.close()
      }
    },
  )

  it('maps a populated target detected during the copy to target_not_empty', async () => {
    const src = await makeTestDb()
    try {
      copyDatabaseTables.mockRejectedValue(new DatabaseCopyTargetNotEmptyError(['settings']))
      await expect(
        migrateBackend({
          sourceDb: src.db as never,
          target: { backend: 'pglite', path: tgt('late-conflict') },
          isPipelineRunning: () => false,
        }),
      ).rejects.toMatchObject({ code: 'target_not_empty' })
    } finally {
      await src.close()
    }
  })

  it('reports ok:false when the table copy reports a mismatch', async () => {
    const src = await makeTestDb()
    try {
      await src.db.insert(schema.users).values({ username: 'mig', passwordHash: 'x' })
      copyDatabaseTables.mockResolvedValue({
        tablesRestored: { users: 1 },
        mismatches: [{ table: 'users', source: 1, target: 1, contentDiffers: true }],
      })

      const report = await migrateBackend({
        sourceDb: src.db as never,
        target: { backend: 'pglite', path: tgt('mismatch') },
        isPipelineRunning: () => false,
      })

      expect(report.ok).toBe(false)
      expect(report.verified).toBe(false)
      expect(report.contentVerified).toBe(false)
      expect(report.mismatches).toEqual([
        { table: 'users', source: 1, target: 1, contentDiffers: true },
      ])
    } finally {
      await src.close()
    }
  })

  it('rejects when the table copy throws mid-transaction', async () => {
    const src = await makeTestDb()
    try {
      await src.db.insert(schema.users).values({ username: 'mig', passwordHash: 'x' })
      copyDatabaseTables.mockRejectedValue(new Error('constraint violation mid-copy'))

      await expect(
        migrateBackend({
          sourceDb: src.db as never,
          target: { backend: 'pglite', path: tgt('throw') },
          isPipelineRunning: () => false,
        }),
      ).rejects.toThrow(/constraint violation mid-copy/)
    } finally {
      await src.close()
    }
  })
})
