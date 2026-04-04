// @vitest-environment node

import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initEncryption } from '@/core/crypto'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import type { BackupFile, OpsDb } from '@/core/ops/types'

function makeMockDb(tableData: Record<string, unknown[]> = {}): OpsDb {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: unknown) => {
        const name = getTableName(table as Parameters<typeof getTableName>[0])
        return Promise.resolve(tableData[name] ?? [])
      }),
    })),
  } as unknown as OpsDb
}

describe('getKeyFingerprint', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns null when encryption is disabled', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption(undefined)
    expect(getKeyFingerprint()).toBeNull()
  })

  it('returns a sha256: prefixed string when encryption is enabled', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('test-encryption-key-1234')
    const fp = getKeyFingerprint()
    expect(fp).not.toBeNull()
    expect(fp).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('returns same fingerprint for same key', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('test-key-abc')
    const fp1 = getKeyFingerprint()
    initEncryption('test-key-abc')
    const fp2 = getKeyFingerprint()
    expect(fp1).toBe(fp2)
  })

  it('returns different fingerprint for different key', async () => {
    const { initEncryption, getKeyFingerprint } = await import('@/core/crypto')
    initEncryption('key-alpha')
    const fp1 = getKeyFingerprint()
    initEncryption('key-beta')
    const fp2 = getKeyFingerprint()
    expect(fp1).not.toBe(fp2)
  })
})

describe('createBackup', () => {
  it('returns a valid BackupFile with version and timestamp', async () => {
    const db = makeMockDb({
      settings: [{ id: 1, lidarrUrl: 'http://lidarr:8686' }],
      users: [{ id: 1, username: 'admin' }],
    })
    const result = await createBackup(db, { includeCaches: false })

    expect(result.version).toBe(1)
    expect(result.appVersion).toBeDefined()
    expect(result.createdAt).toBeDefined()
    expect(result.includesCaches).toBe(false)
    expect(result.data.settings).toHaveLength(1)
    expect(result.data.users).toHaveLength(1)
  })

  it('excludes cache tables when includeCaches is false', async () => {
    const db = makeMockDb({
      artists: [{ id: 1, name: 'Artist' }],
      genres: [{ id: 1, name: 'Rock' }],
      artist_metadata: [{ id: 1, name: 'Artist' }],
    })
    const result = await createBackup(db, { includeCaches: false })

    expect(result.data.artists).toBeUndefined()
    expect(result.data.genres).toBeUndefined()
    expect(result.data.artistMetadata).toBeUndefined()
  })

  it('includes cache tables when includeCaches is true', async () => {
    const db = makeMockDb({
      artists: [{ id: 1, name: 'Artist' }],
      genres: [{ id: 1, name: 'Rock' }],
      artist_metadata: [{ id: 1, name: 'Meta' }],
    })
    const result = await createBackup(db, { includeCaches: true })

    expect(result.data.artists).toHaveLength(1)
    expect(result.data.genres).toHaveLength(1)
    expect(result.data.artistMetadata).toHaveLength(1)
    expect(result.includesCaches).toBe(true)
  })

  it('includes encryption key fingerprint when encryption is enabled', async () => {
    initEncryption('test-backup-key')
    const db = makeMockDb()
    const result = await createBackup(db, { includeCaches: false })

    expect(result.encryptionKeyHash).toMatch(/^sha256:/)

    // Clean up
    initEncryption(undefined)
  })
})

function makeBackupFile(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    version: 1,
    appVersion: '0.14.0',
    createdAt: '2026-04-04T12:00:00Z',
    encryptionKeyHash: null,
    includesCaches: false,
    data: {
      settings: [{ id: 1, lidarrUrl: 'http://lidarr:8686' }],
      users: [{ id: 1, username: 'admin', passwordHash: 'hash' }],
      oauthTokens: [],
      oidcTokens: [],
      targets: [],
      subscriptions: [],
      subscriptionRuns: [],
      recommendationBatches: [],
      recommendations: [],
      playlists: [],
      playlistTracks: [],
    },
    ...overrides,
  }
}

function makeMockUpsertDb(): OpsDb & { insertCalls: Record<string, unknown[][]> } {
  const insertCalls: Record<string, unknown[][]> = {}
  const insertFn = vi.fn().mockImplementation((table: unknown) => {
    const name = getTableName(table as Parameters<typeof getTableName>[0])
    return {
      values: vi.fn().mockImplementation((rows: unknown[]) => {
        if (!insertCalls[name]) insertCalls[name] = []
        insertCalls[name].push(Array.isArray(rows) ? rows : [rows])
        return {
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }
      }),
    }
  })
  const selectFn = vi.fn().mockReturnValue({
    from: vi.fn().mockResolvedValue([]),
  })
  const db = {
    insertCalls,
    insert: insertFn,
    select: selectFn,
    // Restore wraps everything in a transaction -- call the callback with `this`
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb(db)
    }),
  }
  return db as unknown as OpsDb & { insertCalls: Record<string, unknown[][]> }
}

describe('restoreBackup', () => {
  it('validates backup file version', async () => {
    const db = makeMockUpsertDb()
    const backup = makeBackupFile({ version: 999 })
    await expect(restoreBackup(db, backup)).rejects.toThrow('Unsupported backup version')
  })

  it('detects encryption key mismatch and rejects without force', async () => {
    initEncryption('different-key')
    const db = makeMockUpsertDb()
    const backup = makeBackupFile({ encryptionKeyHash: 'sha256:0000000000' })
    const result = await restoreBackup(db, backup, { force: false })

    expect(result.encryptionMismatch).toBe(true)
    expect(result.affectedEncryptedFields.length).toBeGreaterThan(0)
    expect(result.tablesRestored).toEqual({})

    initEncryption(undefined)
  })

  it('restores with force despite key mismatch', async () => {
    initEncryption('different-key')
    const db = makeMockUpsertDb()
    const backup = makeBackupFile({ encryptionKeyHash: 'sha256:0000000000' })
    const result = await restoreBackup(db, backup, { force: true })

    expect(result.encryptionMismatch).toBe(true)
    expect(Object.keys(result.tablesRestored).length).toBeGreaterThan(0)

    initEncryption(undefined)
  })

  it('restores tables in FK dependency order', async () => {
    const db = makeMockUpsertDb()
    const backup = makeBackupFile()
    backup.data.targets = [{ id: 1, type: 'lidarr', userId: 1 }]
    await restoreBackup(db, backup)

    const tableOrder = Object.keys(db.insertCalls)
    const settingsIdx = tableOrder.indexOf('settings')
    const usersIdx = tableOrder.indexOf('users')
    const targetsIdx = tableOrder.indexOf('targets')

    // settings and users must come before targets
    expect(settingsIdx).toBeLessThan(targetsIdx)
    expect(usersIdx).toBeLessThan(targetsIdx)
  })

  it('returns count of restored rows per table', async () => {
    const db = makeMockUpsertDb()
    const backup = makeBackupFile()
    backup.data.users = [
      { id: 1, username: 'admin' },
      { id: 2, username: 'user2' },
    ]
    const result = await restoreBackup(db, backup)

    expect(result.tablesRestored.users).toBe(2)
    expect(result.tablesRestored.settings).toBe(1)
  })

  it('skips empty tables without error', async () => {
    const db = makeMockUpsertDb()
    const backup = makeBackupFile()
    backup.data.targets = []
    backup.data.subscriptions = []
    const result = await restoreBackup(db, backup)

    expect(result.tablesRestored.targets).toBeUndefined()
    expect(result.warnings).toHaveLength(0)
  })
})
