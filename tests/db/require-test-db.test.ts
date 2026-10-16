// @vitest-environment node

import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { REQUIRE_TEST_DB } from '../helpers/require-db'

// Makes the CI PostgreSQL job fail when the database service is missing, so
// the DB-gated suites cannot all skip and still report green.
describe.runIf(REQUIRE_TEST_DB)('required test database', () => {
  it('is configured and reachable', async () => {
    const url = process.env.DATABASE_URL
    expect(url, 'DATABASE_URL must be set when DIGARR_REQUIRE_TEST_DB=1').toBeTruthy()
    const pool = new pg.Pool({ connectionString: url, max: 1 })
    try {
      const res = await pool.query('SELECT 1 AS ok')
      expect(res.rows[0]).toEqual({ ok: 1 })
    } finally {
      await pool.end()
    }
  })
})
