import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { beforeAll, describe, expect, it } from 'vitest'
import { createBackup, restoreBackup } from '@/core/ops/backup'
import { getPendingMigrations } from '@/core/ops/upgrade'
import * as schema from '@/db/schema'

type DB = ReturnType<typeof drizzle<typeof schema>>
let db: DB

beforeAll(async () => {
  const client = new PGlite() // in-memory
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
})

describe('pglite backend contract', () => {
  it('applies all repo migrations and creates core tables', async () => {
    const res = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','settings','artists')`,
    )
    expect(res.rows.length).toBe(3)
  })

  it('db.execute returns the {rows} shape upgrade.ts/health depend on', async () => {
    const res = await db.execute(sql`SELECT 1 AS x`)
    expect(Array.isArray(res.rows)).toBe(true)
    expect((res.rows[0] as { x: number }).x).toBe(1)
  })

  it('getPendingMigrations works against pglite introspection', async () => {
    const status = await getPendingMigrations(db as never)
    expect(status.pendingCount).toBe(0)
    expect(status.targetVersion).not.toBeNull()
  })

  it('round-trips a backup on pglite', async () => {
    await db.execute(sql`INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
    const backup = await createBackup(db as never, { includeCaches: true })
    const result = await restoreBackup(db as never, backup, { force: true })
    expect(result.tablesRestored.settings).toBeGreaterThanOrEqual(1)
    expect(result.warnings).toEqual([])
  })

  // Much app code calls .toISOString()/.getTime() on selected timestamp columns.
  // Confirm drizzle's timestamp({withTimezone}) maps to a JS Date under PGlite,
  // selected through the QUERY BUILDER (not raw execute), for a representative table.
  it('returns timestamptz columns as Date via the query builder', async () => {
    const [row] = await db
      .insert(schema.users)
      .values({ username: 'tz-probe', passwordHash: 'x' })
      .returning()
    expect(row).toBeDefined()
    expect(row?.createdAt).toBeInstanceOf(Date)
  })
})
