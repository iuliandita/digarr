// @vitest-environment node

import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import * as schema from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

// PGlite cold-start and migrations need headroom under full-suite contention.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

const { Pool } = pg
const migrationUrl = new URL('../../drizzle/0044_drop_oidc_tokens.sql', import.meta.url)

function readMigrationSql(): string {
  return readFileSync(migrationUrl, 'utf8').replaceAll('--> statement-breakpoint', '')
}

describe('OIDC token table retirement', () => {
  it('does not export the retired table from the schema', () => {
    expect(schema).not.toHaveProperty('oidcTokens')
  })

  it('omits the table from a fully migrated PGlite database', async () => {
    const { db, close } = await makeTestDb()

    try {
      const result = await db.execute(sql`SELECT to_regclass('public.oidc_tokens') AS "relation"`)

      expect((result.rows[0] as { relation: string | null }).relation).toBeNull()
    } finally {
      await close()
    }
  })

  it('drops a populated legacy table idempotently on PGlite', async () => {
    const client = new PGlite()

    try {
      await client.exec(`
        CREATE TABLE oidc_tokens (id integer PRIMARY KEY);
        INSERT INTO oidc_tokens (id) VALUES (1);
      `)

      const migrationSql = readMigrationSql()
      await client.exec(migrationSql)
      await client.exec(migrationSql)

      const result = await client.query<{ relation: string | null }>(
        `SELECT to_regclass('public.oidc_tokens') AS "relation"`,
      )
      expect(result.rows[0]?.relation).toBeNull()
    } finally {
      await client.close()
    }
  })

  it('fails closed when an unexpected dependency exists', async () => {
    const client = new PGlite()

    try {
      await client.exec(`
        CREATE TABLE oidc_tokens (id integer PRIMARY KEY);
        INSERT INTO oidc_tokens (id) VALUES (1);
        CREATE VIEW oidc_token_dependency AS SELECT id FROM oidc_tokens;
      `)

      await expect(client.exec(readMigrationSql())).rejects.toThrow()

      const relations = await client.query<{
        tableRelation: string | null
        viewRelation: string | null
      }>(`
        SELECT
          to_regclass('public.oidc_tokens') AS "tableRelation",
          to_regclass('public.oidc_token_dependency') AS "viewRelation"
      `)
      expect(relations.rows[0]).toEqual({
        tableRelation: 'oidc_tokens',
        viewRelation: 'oidc_token_dependency',
      })

      const dependentRows = await client.query<{ id: number }>(
        'SELECT id FROM oidc_token_dependency',
      )
      expect(dependentRows.rows).toEqual([{ id: 1 }])
    } finally {
      await client.close()
    }
  })

  it.runIf(Boolean(process.env.DATABASE_URL))(
    'drops a populated legacy table idempotently in a PostgreSQL temporary schema',
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL })
      const client = await pool.connect()

      try {
        await client.query('SET search_path TO pg_temp')
        await client.query('CREATE TABLE oidc_tokens (id integer PRIMARY KEY)')
        await client.query('INSERT INTO oidc_tokens (id) VALUES (1)')

        const migrationSql = readMigrationSql()
        await client.query(migrationSql)
        await client.query(migrationSql)

        const result = await client.query<{ relation: string | null }>(
          `SELECT to_regclass('oidc_tokens') AS "relation"`,
        )
        expect(result.rows[0]?.relation).toBeNull()
      } finally {
        await client.query('RESET search_path')
        client.release()
        await pool.end()
      }
    },
  )
})
