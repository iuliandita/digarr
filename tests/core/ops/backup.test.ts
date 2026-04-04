// @vitest-environment node

import { getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initEncryption } from '@/core/crypto'
import { createBackup } from '@/core/ops/backup'
import type { OpsDb } from '@/core/ops/types'

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
