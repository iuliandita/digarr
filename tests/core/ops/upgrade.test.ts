// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPendingMigrations, runPreFlightCheck } from '@/core/ops/upgrade'

vi.mock('@/core/ops/backup', () => ({
  createBackup: vi.fn(),
}))

// Mock fs for journal reading
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([]),
    unlinkSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now(), mtime: new Date() }),
  }
})

import { existsSync, readFileSync } from 'node:fs'
import { createBackup } from '@/core/ops/backup'

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
    vi.mocked(createBackup).mockReset()
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
    expect(createBackup).not.toHaveBeenCalled()
  })

  it('still runs auto-backup when app tables already exist', async () => {
    vi.mocked(createBackup).mockResolvedValue({
      version: 1,
      appVersion: '0.0.0-test',
      createdAt: '2026-04-13T00:00:00.000Z',
      encryptionKeyHash: null,
      includesCaches: false,
      data: {
        settings: [],
        users: [],
        oauthTokens: [],
        oidcTokens: [],
        targets: [],
        subscriptions: [],
        jobRuns: [],
        recommendationBatches: [],
        recommendations: [],
        playlists: [],
        playlistTracks: [],
        artistBlocks: [],
      },
    })

    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ has_tables: true }] }),
    }

    const result = await runPreFlightCheck(mockDb as never)

    expect(result.pendingCount).toBe(3)
    expect(result.backupSkipped).toBe(false)
    expect(createBackup).toHaveBeenCalledTimes(1)
    expect(result.backupPath).toContain('pre-migrate-')
  })
})
