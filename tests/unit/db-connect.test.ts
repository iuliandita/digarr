import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertSafePglitePath,
  backendFingerprint,
  classifyTargetError,
  connectTarget,
} from '@/db/connect'

// PGlite WASM cold-start + migrations can exceed the 5s default under full-suite
// parallel contention; these tests pass in isolation. Give them headroom.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

describe('connectTarget', () => {
  beforeEach(() => {
    process.env.DIGARR_MIGRATE_DATA_ROOT = mkdtempSync(join(tmpdir(), 'digarr-root-'))
  })
  afterEach(() => {
    delete process.env.DIGARR_MIGRATE_DATA_ROOT
  })

  it('opens a pglite target under the allowed root, runs migrations, pings, closes', async () => {
    const dir = join(process.env.DIGARR_MIGRATE_DATA_ROOT as string, 'tgt-a')
    const t = await connectTarget({ backend: 'pglite', path: dir })
    await t.runMigrations()
    await t.ping()
    const r = await t.db.execute(
      sql`select count(*)::int n from information_schema.tables where table_name='users'`,
    )
    expect((r as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(1)
    await t.close()
  })

  it('describe() masks the postgres password (no live connection needed)', async () => {
    const t = await connectTarget({
      backend: 'postgres',
      dsn: 'postgres://u:secret@db.example:5432/digarr',
    })
    expect(t.describe()).toBe('postgres://u@db.example:5432/digarr')
    expect(t.describe()).not.toContain('secret')
    await t.close()
  })

  it('backendFingerprint is stable per cluster and differs across pglite files', async () => {
    const a = await connectTarget({
      backend: 'pglite',
      path: join(process.env.DIGARR_MIGRATE_DATA_ROOT as string, 'fp-a'),
    })
    const b = await connectTarget({
      backend: 'pglite',
      path: join(process.env.DIGARR_MIGRATE_DATA_ROOT as string, 'fp-b'),
    })
    await a.runMigrations()
    await b.runMigrations()
    const fpA = await backendFingerprint(a.db)
    const fpA2 = await backendFingerprint(a.db)
    const fpB = await backendFingerprint(b.db)
    expect(fpA).toBe(fpA2)
    expect(fpA).not.toBe(fpB)
    await a.close()
    await b.close()
  })

  it('rejects pglite paths outside the allowed data root or with traversal', () => {
    expect(() => assertSafePglitePath('/etc/passwd')).toThrow(/outside the allowed/i)
    expect(() => assertSafePglitePath('relative/path')).toThrow(/absolute/i)
    expect(() =>
      assertSafePglitePath(join(process.env.DIGARR_MIGRATE_DATA_ROOT as string, '../escape')),
    ).toThrow(/outside the allowed/i)
  })
})

describe('classifyTargetError', () => {
  it('maps socket and pg error codes to safe categories', () => {
    expect(classifyTargetError({ code: 'ECONNREFUSED' })).toBe('unreachable')
    expect(classifyTargetError({ code: 'ENOTFOUND' })).toBe('unreachable')
    expect(classifyTargetError({ code: 'ETIMEDOUT' })).toBe('timeout')
    expect(classifyTargetError({ code: '28P01' })).toBe('auth_failed')
    expect(classifyTargetError({ code: '3D000' })).toBe('db_missing')
  })

  it('classifies the pglite path guard before any connection code', () => {
    expect(
      classifyTargetError(new Error('PGlite path is outside the allowed data root (/x)')),
    ).toBe('invalid_path')
  })

  it('falls back to timeout on message, else unknown, and never leaks the message', () => {
    expect(classifyTargetError(new Error('connection timeout expired'))).toBe('timeout')
    expect(classifyTargetError(new Error('postgres://u:secret@h/db boom'))).toBe('unknown')
    expect(classifyTargetError('weird')).toBe('unknown')
  })
})
