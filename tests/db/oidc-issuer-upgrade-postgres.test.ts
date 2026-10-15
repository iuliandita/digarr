// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { getTableName } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_TABLE_BY_KEY, createBackup, restoreBackup } from '@/core/ops/backup'
import type { BackupFile } from '@/core/ops/types'
import * as schema from '@/db/schema'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const POSTGRES_URL = process.env.DATABASE_URL
const schemaName = `oidc_upgrade_${randomUUID().replaceAll('-', '')}`
let setupPool: pg.Pool
let testPool: pg.Pool

describe.runIf(Boolean(POSTGRES_URL))('OIDC issuer upgrade and restore PostgreSQL', () => {
  beforeAll(async () => {
    if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
    setupPool = new pg.Pool({ connectionString: POSTGRES_URL, max: 2 })
    await setupPool.query(`CREATE SCHEMA "${schemaName}"`)
    for (const table of Object.values(BACKUP_TABLE_BY_KEY)) {
      const name = getTableName(table)
      await setupPool.query(
        `CREATE TABLE "${schemaName}"."${name}" (LIKE public."${name}" INCLUDING ALL)`,
      )
    }
    testPool = new pg.Pool({
      connectionString: POSTGRES_URL,
      max: 1,
      options: `-c search_path=${schemaName} -c statement_timeout=10000`,
    })
  })

  beforeEach(async () => {
    const tables = Object.values(BACKUP_TABLE_BY_KEY).map(
      (table) => `"${schemaName}"."${getTableName(table)}"`,
    )
    await testPool.query(`TRUNCATE ${tables.join(', ')}`)
  })

  afterAll(async () => {
    await testPool?.end()
    if (setupPool) {
      await setupPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await setupPool.end()
    }
  })

  it('quarantines populated old-schema subjects without inferring an issuer during migration', async () => {
    const client = await setupPool.connect()
    try {
      await client.query('SET search_path TO pg_temp')
      await client.query(`
        CREATE TEMP TABLE users (
          id integer PRIMARY KEY,
          username text NOT NULL,
          password_hash text NOT NULL,
          auth_provider text NOT NULL,
          oidc_subject text
        );
        CREATE UNIQUE INDEX users_oidc_subject_unique_idx ON users (oidc_subject);
        INSERT INTO users VALUES
          (1, 'legacy-sso', '', 'oidc', 'same-subject'),
          (2, 'legacy-linked', 'local-password', 'local', 'linked-subject');
      `)
      const migration = readFileSync(
        new URL('../../drizzle/0054_blue_morbius.sql', import.meta.url),
        'utf8',
      ).replaceAll('--> statement-breakpoint', '')

      await client.query(migration)

      const migrated = await client.query(
        'SELECT id, oidc_subject, oidc_issuer, auth_provider, password_hash FROM users ORDER BY id',
      )
      expect(migrated.rows).toEqual([
        {
          id: 1,
          oidc_subject: 'same-subject',
          oidc_issuer: null,
          auth_provider: 'oidc',
          password_hash: '',
        },
        {
          id: 2,
          oidc_subject: 'linked-subject',
          oidc_issuer: null,
          auth_provider: 'local',
          password_hash: 'local-password',
        },
      ])
      await client.query(`
        INSERT INTO users (id, username, password_hash, auth_provider, oidc_subject, oidc_issuer)
        VALUES
          (3, 'provider-a', '', 'oidc', 'same-subject', 'https://identity.example/realm'),
          (4, 'provider-b', '', 'oidc', 'same-subject', 'https://identity.example/realm/');
      `)
      await expect(
        client.query(`
          INSERT INTO users (id, username, password_hash, auth_provider, oidc_subject, oidc_issuer)
          VALUES (5, 'duplicate', '', 'oidc', 'same-subject', 'https://identity.example/realm')
        `),
      ).rejects.toMatchObject({ code: '23505' })
    } finally {
      await client.query('DROP TABLE IF EXISTS pg_temp.users')
      await client.query('RESET search_path')
      client.release()
    }
  })

  it('round-trips exact issuer pairs and restores missing legacy issuers as null', async () => {
    const db = drizzle(testPool, { schema })
    const identities = [
      {
        id: 1,
        username: 'provider-a',
        oidcIssuer: 'https://identity.example/realm',
        oidcSubject: 'shared-subject',
      },
      {
        id: 2,
        username: 'provider-b',
        oidcIssuer: 'https://identity.example/realm/',
        oidcSubject: 'shared-subject',
      },
      { id: 3, username: 'legacy', oidcIssuer: null, oidcSubject: 'legacy-subject' },
    ]
    await db
      .insert(schema.users)
      .values(
        identities.map((identity) => ({ ...identity, passwordHash: '', authProvider: 'oidc' })),
      )
    const backup: BackupFile = JSON.parse(JSON.stringify(await createBackup(db)))
    expect(
      backup.data.users.map(({ id, username, oidcIssuer, oidcSubject }) => ({
        id,
        username,
        oidcIssuer,
        oidcSubject,
      })),
    ).toEqual(identities)
    const legacyRow = backup.data.users.find((user) => user.id === 3)
    if (!legacyRow) throw new Error('Legacy backup row is missing')
    delete legacyRow.oidcIssuer
    await testPool.query("UPDATE users SET oidc_issuer = 'https://changed.example' WHERE id = 3")

    await restoreBackup(db, backup)

    const restored = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        oidcIssuer: schema.users.oidcIssuer,
        oidcSubject: schema.users.oidcSubject,
      })
      .from(schema.users)
      .orderBy(schema.users.id)
    expect(restored).toEqual(identities)
  })

  it.each(['identity', 'username'] as const)(
    'rolls back every restored table on a duplicate %s',
    async (conflict) => {
      const db = drizzle(testPool, { schema })
      await db.insert(schema.settings).values({ id: 1, lidarrUrl: 'https://preserved.example' })
      await db
        .insert(schema.users)
        .values({ id: 1, username: 'preserved', passwordHash: 'original-hash' })
      const before = await createBackup(db)
      const backup: BackupFile = JSON.parse(JSON.stringify(before))
      backup.data.settings = [{ id: 1, lidarrUrl: 'https://replacement.example' }]
      backup.data.users = [
        {
          id: 2,
          username: 'first',
          passwordHash: '',
          oidcIssuer: 'https://identity.example',
          oidcSubject: 'first',
        },
        {
          id: 3,
          username: conflict === 'username' ? 'first' : 'second',
          passwordHash: '',
          oidcIssuer: 'https://identity.example',
          oidcSubject: conflict === 'identity' ? 'first' : 'second',
        },
      ]

      await expect(restoreBackup(db, backup)).rejects.toThrow()

      expect((await createBackup(db)).data).toEqual(before.data)
    },
  )
})
