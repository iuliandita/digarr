// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres'
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PartialBackupConflictError, restoreBackup } from '@/core/ops/backup'
import type { BackupFile, OpsDb } from '@/core/ops/types'
import { getPendingMigrations, runPreFlightCheck } from '@/core/ops/upgrade'
import * as schema from '@/db/schema'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

// Last migration shipped in v1.19.0; 0052-0054 add a settings column, the
// playlist_exports table and a users column on top of it.
const PREVIOUS_RELEASE_LAST_MIGRATION = '0051_plex_accounts_slskd_retry'

type Harness = {
  db: OpsDb
  migrate: (folder: string) => Promise<void>
  close: () => Promise<void>
}

function previousReleaseMigrations(dir: string): string {
  const folder = mkdtempSync(join(dir, 'migrations-'))
  cpSync('drizzle', folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
    entries: { idx: number; tag: string }[]
  }
  const cutoff = journal.entries.find((e) => e.tag === PREVIOUS_RELEASE_LAST_MIGRATION)
  if (!cutoff) throw new Error(`${PREVIOUS_RELEASE_LAST_MIGRATION} not in journal`)
  journal.entries = journal.entries.filter((e) => e.idx <= cutoff.idx)
  writeFileSync(journalPath, JSON.stringify(journal))
  return folder
}

async function makePglite(): Promise<Harness> {
  const client = new PGlite()
  const db = drizzlePglite(client, { schema })
  return {
    db: db as unknown as OpsDb,
    migrate: (folder) => migratePglite(db, { migrationsFolder: folder }),
    close: () => client.close(),
  }
}

async function makePostgres(url: string): Promise<Harness> {
  const name = `digarr_upgrade_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Pool({ connectionString: url, max: 1 })
  await admin.query(`CREATE DATABASE "${name}"`)
  const target = new URL(url)
  target.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: target.toString(), max: 2 })
  const db = drizzleNodePg(pool, { schema })
  // DROP DATABASE ... WITH (FORCE) can terminate a straggling client; an unhandled 'error' event fails the run (#892)
  pool.on('error', () => {})
  admin.on('error', () => {})
  return {
    db: db as unknown as OpsDb,
    migrate: (folder) => migrateNodePg(db, { migrationsFolder: folder }),
    close: async () => {
      await pool.end()
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    },
  }
}

const backends: [string, () => Promise<Harness>, boolean][] = [
  ['PGlite', makePglite, true],
  [
    'PostgreSQL',
    () => makePostgres(process.env.DATABASE_URL as string),
    !!process.env.DATABASE_URL,
  ],
]

describe.each(backends)(
  'pre-migration auto-backup on the previous release schema (%s)',
  (_name, make, enabled) => {
    let dir: string
    let h: Harness

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), 'digarr-upgrade-'))
      vi.stubEnv('DIGARR_BACKUP_DIR', join(dir, 'backups'))
      vi.stubEnv('DIGARR_AUTO_BACKUP', 'true')
      vi.spyOn(console, 'log').mockImplementation(() => {})
      h = await make()
      await h.migrate(previousReleaseMigrations(dir))
      await h.db.execute(sql`INSERT INTO settings (lidarr_url) VALUES ('http://lidarr:8686')`)
      await h.db.execute(sql`
      INSERT INTO users (username, password_hash, oidc_subject)
      VALUES ('alice', 'hash', 'sub-1'), ('bob', 'hash', NULL)`)
      await h.db.execute(sql`INSERT INTO playlists (name, strategy) VALUES ('mix', 'manual')`)
      await h.db.execute(sql`
      INSERT INTO playlist_tracks (playlist_id, artist_name, position) VALUES (1, 'Boards of Canada', 0)`)
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      await h?.close()
      rmSync(dir, { recursive: true, force: true })
    })

    it.runIf(enabled)(
      'writes the snapshot, applies the pending migrations and restores cleanly',
      async () => {
        const before = await getPendingMigrations(h.db)
        expect(before.currentVersion).toBe(PREVIOUS_RELEASE_LAST_MIGRATION)
        expect(before.pendingCount).toBeGreaterThan(0)

        const result = await runPreFlightCheck(h.db)
        expect(result.backupPath).not.toBeNull()

        const backup = JSON.parse(readFileSync(result.backupPath as string, 'utf-8')) as BackupFile
        expect(backup.data.settings).toHaveLength(1)
        expect(backup.data.settings[0]).toMatchObject({ lidarrUrl: 'http://lidarr:8686' })
        expect(backup.data.settings[0]).not.toHaveProperty('digestDeliveryPositions')
        expect(backup.data.users.map((u) => u.username)).toEqual(['alice', 'bob'])
        expect(backup.data.users[0]).not.toHaveProperty('oidcIssuer')
        expect(backup.data.playlistTracks).toHaveLength(1)
        expect(backup.data).not.toHaveProperty('playlistExports')
        expect(backup.absentSchema?.tables).toContain('playlist_exports')
        expect(backup.absentSchema?.columns).toMatchObject({
          settings: ['digest_delivery_positions'],
          users: ['oidc_issuer'],
        })

        await h.migrate('drizzle')
        expect((await getPendingMigrations(h.db)).pendingCount).toBe(0)

        await h.db.execute(sql`INSERT INTO targets (type, name) VALUES ('plex', 'p')`)
        await h.db.execute(sql`
          INSERT INTO playlist_exports (playlist_id, target_id, remote_scope)
          VALUES (1, 1, 'scope')`)
        await expect(restoreBackup(h.db, backup)).rejects.toBeInstanceOf(PartialBackupConflictError)
        await h.db.execute(sql`DELETE FROM playlist_exports`)

        const restored = await restoreBackup(h.db, backup)
        expect(restored.tablesRestored).toMatchObject({ settings: 1, users: 2, playlistTracks: 1 })
        const users = await h.db.execute(sql`SELECT username, oidc_issuer FROM users ORDER BY id`)
        expect(users.rows).toEqual([
          { username: 'alice', oidc_issuer: null },
          { username: 'bob', oidc_issuer: null },
        ])
      },
    )

    it.runIf(enabled)('stops before migrating when the snapshot cannot be written', async () => {
      writeFileSync(join(dir, 'blocker'), 'not a directory')
      vi.stubEnv('DIGARR_BACKUP_DIR', join(dir, 'blocker', 'backups'))
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(runPreFlightCheck(h.db)).rejects.toThrow()

      expect(error).toHaveBeenCalledWith(expect.stringContaining('DIGARR_AUTO_BACKUP=false'))
      expect(existsSync(join(dir, 'blocker', 'backups'))).toBe(false)
    })
  },
)
