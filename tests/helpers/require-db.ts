export const REQUIRE_TEST_DB = process.env.DIGARR_REQUIRE_TEST_DB === '1'

export function hasPostgresEnv(): boolean {
  return (
    process.env.DATABASE_URL !== undefined ||
    (process.env.DB_HOST !== undefined &&
      process.env.DB_USER !== undefined &&
      process.env.DB_NAME !== undefined)
  )
}

/** Whether a DB-gated suite should run; with DIGARR_REQUIRE_TEST_DB=1 a missing database is an error. */
export function dbSuiteEnabled(): boolean {
  const enabled = hasPostgresEnv()
  if (!enabled && REQUIRE_TEST_DB) {
    throw new Error('DIGARR_REQUIRE_TEST_DB=1 but no PostgreSQL connection is configured')
  }
  return enabled
}

/** Call from a hook when a connection attempt fails, so a required database never skips silently. */
export function failIfDbRequired(cause: unknown): void {
  if (REQUIRE_TEST_DB) {
    throw new Error('DIGARR_REQUIRE_TEST_DB=1 but the test database is unreachable', { cause })
  }
}

/** Refuse destructive suites against anything that is not clearly a throwaway database. */
export function assertDisposableDatabase(url: string): void {
  const name = decodeURIComponent(new URL(url).pathname.slice(1))
  if (/test/i.test(name) || process.env.DIGARR_ALLOW_DESTRUCTIVE_TEST_DB === '1') return
  throw new Error(
    `Refusing to truncate database "${name}": its name must contain "test" ` +
      '(or set DIGARR_ALLOW_DESTRUCTIVE_TEST_DB=1)',
  )
}
