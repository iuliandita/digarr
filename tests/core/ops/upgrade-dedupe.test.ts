// @vitest-environment node

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpsDb } from '@/core/ops/types'
import { dedupeBeforeUniqueIndexes, runPreFlightCheck } from '@/core/ops/upgrade'
import * as schema from '@/db/schema'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const LAST_BEFORE_UNIQUE_INDEXES = '0023_nebulous_luckman'

function migrationsUpTo(dir: string, lastTag: string): string {
  const folder = mkdtempSync(join(dir, 'migrations-'))
  cpSync('drizzle', folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
    entries: { idx: number; tag: string }[]
  }
  const cutoff = journal.entries.find((e) => e.tag === lastTag)
  if (!cutoff) throw new Error(`${lastTag} not in journal`)
  journal.entries = journal.entries.filter((e) => e.idx <= cutoff.idx)
  writeFileSync(journalPath, JSON.stringify(journal))
  return folder
}

describe('duplicate cleanup before migrations 0024 and 0028 (PGlite)', () => {
  let dir: string
  let client: PGlite
  let db: ReturnType<typeof drizzle<typeof schema>>
  let ops: OpsDb

  const rows = async (query: ReturnType<typeof sql>) =>
    (await db.execute(query)).rows as Record<string, unknown>[]

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'digarr-dedupe-'))
    vi.stubEnv('DIGARR_BACKUP_DIR', join(dir, 'backups'))
    vi.stubEnv('DIGARR_AUTO_BACKUP', 'true')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    client = new PGlite()
    db = drizzle(client, { schema })
    ops = db as unknown as OpsDb
    await migrate(db, { migrationsFolder: migrationsUpTo(dir, LAST_BEFORE_UNIQUE_INDEXES) })

    await db.execute(sql`
      INSERT INTO users (username, password_hash, email, oidc_subject) VALUES
        ('alice', 'h', 'same@example.test', 'sub-1'),
        ('bob', 'h', 'same@example.test', 'sub-1'),
        ('carol', 'h', 'carol@example.test', NULL),
        ('dave', 'h', NULL, NULL),
        ('erin', 'h', NULL, NULL)`)
    await db.execute(sql`
      INSERT INTO library_sync_state (user_id, source, last_sync_status) VALUES
        (NULL, 'plex', 'old'), (NULL, 'plex', 'newest'), (1, 'plex', 'user')`)
    await db.execute(sql`
      INSERT INTO library_match_overrides (user_id, source, source_artist_id, note, updated_at) VALUES
        (NULL, 'plex', 'a1', 'stale', now() - interval '1 day'),
        (NULL, 'plex', 'a1', 'latest', now()),
        (NULL, 'plex', 'a2', 'only', now())`)
    await db.execute(sql`
      INSERT INTO library_album_match_overrides (user_id, source, source_album_id, note, updated_at) VALUES
        (NULL, 'jellyfin', 'b1', 'latest', now()),
        (NULL, 'jellyfin', 'b1', 'stale', now() - interval '1 day')`)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await client?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('collapses duplicates so the pending migrations apply', async () => {
    const result = await runPreFlightCheck(ops)
    expect(result.backupPath).not.toBeNull()

    await migrate(db, { migrationsFolder: 'drizzle' })

    expect(await rows(sql`SELECT username, email, oidc_subject FROM users ORDER BY id`)).toEqual([
      { username: 'alice', email: 'same@example.test', oidc_subject: 'sub-1' },
      { username: 'bob', email: null, oidc_subject: null },
      { username: 'carol', email: 'carol@example.test', oidc_subject: null },
      { username: 'dave', email: null, oidc_subject: null },
      { username: 'erin', email: null, oidc_subject: null },
    ])
    expect(
      await rows(sql`SELECT user_id, last_sync_status FROM library_sync_state ORDER BY id`),
    ).toEqual([
      { user_id: null, last_sync_status: 'newest' },
      { user_id: 1, last_sync_status: 'user' },
    ])
    expect(
      await rows(sql`SELECT source_artist_id, note FROM library_match_overrides ORDER BY id`),
    ).toEqual([
      { source_artist_id: 'a1', note: 'latest' },
      { source_artist_id: 'a2', note: 'only' },
    ])
    expect(await rows(sql`SELECT note FROM library_album_match_overrides`)).toEqual([
      { note: 'latest' },
    ])
  })

  it('is a no-op once the indexes exist', async () => {
    await runPreFlightCheck(ops)
    await migrate(db, { migrationsFolder: 'drizzle' })
    const warn = vi.mocked(console.warn)
    warn.mockClear()

    expect((await runPreFlightCheck(ops)).pendingCount).toBe(0)
    await dedupeBeforeUniqueIndexes(ops, ['0024_x', '0028_x'])

    expect(warn).not.toHaveBeenCalled()
    expect(await rows(sql`SELECT count(*)::int AS n FROM library_sync_state`)).toEqual([{ n: 2 }])
  })
})
