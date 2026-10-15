// @vitest-environment node

import { randomUUID } from 'node:crypto'
import { getTableName } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BACKUP_TABLE_BY_KEY,
  copyDatabaseTables,
  DatabaseCopyTargetNotEmptyError,
} from '@/core/ops/backup'
import type { OpsDb } from '@/core/ops/types'
import * as schema from '@/db/schema'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const POSTGRES_URL = process.env.DATABASE_URL
const schemaName = `migration_guard_${randomUUID().replaceAll('-', '')}`
const applicationName = `migration-guard-${randomUUID()}`
let setupPool: pg.Pool
let targetPool: pg.Pool
let sourcePool: pg.Pool

describe.runIf(Boolean(POSTGRES_URL))('backend migration PostgreSQL concurrency', () => {
  beforeAll(async () => {
    if (!POSTGRES_URL) throw new Error('DATABASE_URL is required')
    setupPool = new pg.Pool({ connectionString: POSTGRES_URL, max: 3 })
    await setupPool.query(`CREATE SCHEMA "${schemaName}"`)
    // Clone migrated definitions without copying application data or foreign keys.
    for (const table of Object.values(BACKUP_TABLE_BY_KEY)) {
      const name = getTableName(table)
      await setupPool.query(
        `CREATE TABLE "${schemaName}"."${name}" (LIKE public."${name}" INCLUDING ALL)`,
      )
    }
    targetPool = new pg.Pool({
      connectionString: POSTGRES_URL,
      max: 1,
      application_name: applicationName,
      options: `-c search_path=${schemaName} -c statement_timeout=10000`,
    })
    await setupPool.query(`CREATE SCHEMA "${schemaName}_source"`)
    for (const table of Object.values(BACKUP_TABLE_BY_KEY)) {
      const name = getTableName(table)
      await setupPool.query(
        `CREATE TABLE "${schemaName}_source"."${name}" (LIKE public."${name}" INCLUDING ALL)`,
      )
    }
    sourcePool = new pg.Pool({
      connectionString: POSTGRES_URL,
      max: 1,
      options: `-c search_path=${schemaName}_source -c statement_timeout=10000`,
    })
  })

  afterAll(async () => {
    await targetPool?.end()
    await sourcePool?.end()
    if (setupPool) {
      await setupPool.query(`DROP SCHEMA IF EXISTS "${schemaName}_source" CASCADE`)
      await setupPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await setupPool.end()
    }
  })

  it('preserves a target row committed while the guarded copy waits for its table lock', async () => {
    const targetDb = drizzle(targetPool, { schema })
    const source = { select: vi.fn() } as unknown as Pick<OpsDb, 'select'>
    const writer = await setupPool.connect()
    let transactionOpen = false
    let operation: ReturnType<typeof copyDatabaseTables> | undefined

    try {
      await writer.query('BEGIN')
      transactionOpen = true
      await writer.query(`INSERT INTO "${schemaName}".settings (id, lidarr_url) VALUES (1, $1)`, [
        'https://preserved.example',
      ])
      const pid = Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid)

      operation = copyDatabaseTables(source, targetDb, { requireEmptyTarget: true })
      void operation.catch(() => undefined)
      await expect
        .poll(
          async () => {
            const result = await setupPool.query<{ blocked: boolean }>(
              `SELECT state = 'active' AND wait_event_type = 'Lock'
                 AND $2 = ANY(pg_blocking_pids(pid)) AS blocked
               FROM pg_stat_activity WHERE application_name = $1`,
              [applicationName, pid],
            )
            return result.rows.some((row) => row.blocked)
          },
          { timeout: 5_000, interval: 20 },
        )
        .toBe(true)

      await writer.query('COMMIT')
      transactionOpen = false

      await expect(operation).rejects.toBeInstanceOf(DatabaseCopyTargetNotEmptyError)
      await expect(operation).rejects.toMatchObject({ affectedTables: ['settings'] })
      expect(source.select).not.toHaveBeenCalled()
      const preserved = await targetPool.query('SELECT id, lidarr_url FROM settings')
      expect(preserved.rows).toEqual([{ id: 1, lidarr_url: 'https://preserved.example' }])
    } finally {
      if (transactionOpen) await writer.query('ROLLBACK')
      await operation?.catch(() => undefined)
      writer.release()
    }
  })

  it('copies exact issuer bindings and quarantined legacy subjects without merging identities', async () => {
    const sourceDb = drizzle(sourcePool, { schema })
    const targetDb = drizzle(targetPool, { schema })
    const identities = [
      { username: 'issuer-one', oidcIssuer: 'https://identity.example/realm', oidcSubject: 'same' },
      {
        username: 'issuer-two',
        oidcIssuer: 'https://identity.example/realm/',
        oidcSubject: 'same',
      },
      { username: 'legacy', oidcIssuer: null, oidcSubject: 'legacy-subject' },
    ]
    await sourceDb.insert(schema.users).values(
      identities.map((identity, index) => ({
        id: index + 1,
        passwordHash: 'test-hash',
        authProvider: 'oidc',
        ...identity,
      })),
    )

    const result = await copyDatabaseTables(sourceDb, targetDb)

    expect(result.mismatches).toEqual([])
    expect(result.tablesRestored.users).toBe(3)
    const copied = await targetDb
      .select({
        username: schema.users.username,
        oidcIssuer: schema.users.oidcIssuer,
        oidcSubject: schema.users.oidcSubject,
      })
      .from(schema.users)
      .orderBy(schema.users.id)
    expect(copied).toEqual(identities)
  })
})
