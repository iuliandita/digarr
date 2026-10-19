// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPendingMigrations, runPreFlightCheck } from '@/core/ops/upgrade'

vi.mock('@/core/ops/backup', () => ({
  writeBackupSnapshot: vi.fn(),
}))

// Mock fs for journal reading
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
    openSync: vi.fn().mockReturnValue(99),
    writeSync: vi.fn((_fd: number, bytes: Uint8Array) => bytes.length),
    closeSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([]),
    unlinkSync: vi.fn(),
    renameSync: vi.fn(),
    rmSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now(), mtime: new Date() }),
  }
})

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { writeBackupSnapshot } from '@/core/ops/backup'

const mockJournal = {
  version: '7',
  dialect: 'postgresql',
  entries: [
    { idx: 0, version: '7', when: 1700000000000, tag: '0000_wet_karnak', breakpoints: true },
    {
      idx: 1,
      version: '7',
      when: 1700000001000,
      tag: '0001_massive_wild_child',
      breakpoints: true,
    },
    {
      idx: 2,
      version: '7',
      when: 1700000002000,
      tag: '0002_dazzling_madame_web',
      breakpoints: true,
    },
  ],
}

describe('getPendingMigrations', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockJournal))
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('returns zero pending when all migrations are applied', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          { hash: 'h0', created_at: '1' },
          { hash: 'h1', created_at: '2' },
          { hash: 'h2', created_at: '3' },
        ],
      }),
    }

    const result = await getPendingMigrations(mockDb as never)
    expect(result.pendingCount).toBe(0)
    expect(result.pendingMigrations).toEqual([])
  })

  it('detects pending migrations', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({ rows: [{ hash: 'h0', created_at: '1' }] }),
    }

    const result = await getPendingMigrations(mockDb as never)
    expect(result.pendingCount).toBe(2)
    expect(result.pendingMigrations).toEqual([
      '0001_massive_wild_child',
      '0002_dazzling_madame_web',
    ])
    expect(result.currentVersion).toBe('0000_wet_karnak')
    expect(result.targetVersion).toBe('0002_dazzling_madame_web')
  })

  it('handles empty database (fresh install)', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    }

    const result = await getPendingMigrations(mockDb as never)
    expect(result.pendingCount).toBe(3)
    expect(result.currentVersion).toBeNull()
    expect(result.targetVersion).toBe('0002_dazzling_madame_web')
  })

  it('returns empty when journal file is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const mockDb = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    }

    const result = await getPendingMigrations(mockDb as never)
    expect(result.pendingCount).toBe(0)
  })
})

describe('runPreFlightCheck', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockJournal))
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(writeBackupSnapshot).mockReset()
    vi.mocked(writeBackupSnapshot).mockImplementation(async (_db, write) => {
      write('{}')
      return {}
    })
    vi.mocked(mkdirSync).mockReset()
    vi.mocked(writeSync).mockClear()
    vi.mocked(unlinkSync).mockReset()
    vi.mocked(readdirSync).mockReturnValue([])
    vi.stubEnv('DIGARR_AUTO_BACKUP', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('skips auto-backup on a fresh database with no app tables yet', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ has_tables: false }] }),
    }

    const result = await runPreFlightCheck(mockDb as never)

    expect(result.pendingCount).toBe(3)
    expect(result.backupSkipped).toBe(true)
    expect(result.backupPath).toBeNull()
    expect(writeBackupSnapshot).not.toHaveBeenCalled()
  })

  it('still runs auto-backup when app tables already exist', async () => {
    vi.mocked(readdirSync).mockReturnValue(
      Array.from({ length: 15 }, (_, index) => `pre-migrate-${index}.json`) as never,
    )
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ has_tables: true }] }),
    }

    const result = await runPreFlightCheck(mockDb as never)

    expect(result.pendingCount).toBe(3)
    expect(result.backupSkipped).toBe(false)
    expect(writeBackupSnapshot).toHaveBeenCalledExactlyOnceWith(mockDb, expect.any(Function), {
      includeCaches: true,
      tolerateMissingSchema: true,
    })
    expect(writeSync).toHaveBeenCalledTimes(1)
    expect(unlinkSync).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeSync).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(unlinkSync).mock.invocationCallOrder[0] ?? 0,
    )
    expect(result.backupPath).toContain('pre-migrate-')
  })

  it.each(['mkdir', 'snapshot', 'write'] as const)(
    'rejects pre-flight when the required backup fails at %s',
    async (stage) => {
      const failure = new Error(`backup ${stage} failed`)
      vi.mocked(readdirSync).mockReturnValue(
        Array.from({ length: 15 }, (_, index) => `pre-migrate-${index}.json`) as never,
      )
      if (stage === 'mkdir')
        vi.mocked(mkdirSync).mockImplementation(() => {
          throw failure
        })
      if (stage === 'snapshot') vi.mocked(writeBackupSnapshot).mockRejectedValue(failure)
      if (stage === 'write')
        vi.mocked(writeSync).mockImplementationOnce(() => {
          throw failure
        })
      const mockDb = {
        execute: vi.fn().mockResolvedValue({ rows: [{ hash: 'h0', created_at: '1' }] }),
      }

      await expect(runPreFlightCheck(mockDb as never)).rejects.toThrow(failure)
      expect(unlinkSync).not.toHaveBeenCalled()
      if (stage !== 'write') expect(writeSync).not.toHaveBeenCalled()
      if (stage === 'mkdir') expect(writeBackupSnapshot).not.toHaveBeenCalled()
    },
  )

  it.each(['no pending migrations', 'explicit override'])(
    'does not back up with %s',
    async (reason) => {
      const applied = reason === 'no pending migrations' ? 3 : 1
      if (reason === 'explicit override') vi.stubEnv('DIGARR_AUTO_BACKUP', 'false')
      const mockDb = {
        execute: vi.fn().mockResolvedValue({ rows: Array.from({ length: applied }, () => ({})) }),
      }

      const result = await runPreFlightCheck(mockDb as never)

      expect(result.backupSkipped).toBe(reason === 'explicit override')
      expect(result.backupError).toBeNull()
      expect(writeBackupSnapshot).not.toHaveBeenCalled()
      expect(writeSync).not.toHaveBeenCalled()
    },
  )
})
