// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autoBackup } from '@/core/ops/upgrade'

vi.mock('@/core/ops/backup', () => ({
  createBackupSnapshot: vi.fn(async () => ({ version: 1, data: {} })),
}))

let root: string
let dir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'digarr-autobackup-'))
  dir = join(root, 'backups')
  vi.stubEnv('DIGARR_BACKUP_DIR', dir)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('autoBackup file', () => {
  it('writes an owner-only file in an owner-only directory with a second-resolution name', async () => {
    const path = await autoBackup({} as never, '0001', '0002')

    expect(path).toMatch(/pre-migrate-\d{4}-\d{2}-\d{2}T\d{6}-0001-0002\.json$/)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it('leaves no partial backup behind when the write fails after data hit disk', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-17T01:02:03.456Z') })
    const target = 'pre-migrate-2026-10-17T010203-0001-0002.json'
    // A non-empty directory at the final name makes the rename fail after the temp file is written.
    mkdirSync(join(dir, target, 'blocker'), { recursive: true })

    try {
      await expect(autoBackup({} as never, '0001', '0002')).rejects.toThrow()
    } finally {
      vi.useRealTimers()
    }
    expect(readdirSync(dir)).toEqual([target])
  })
})
