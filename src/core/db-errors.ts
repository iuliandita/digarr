/**
 * Detect a Postgres unique-violation (`23505`), optionally scoped to a specific
 * constraint/index name. Used as a race backstop when an app-level pre-check
 * (e.g. duplicate email) loses to a concurrent insert/update.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (err === null || typeof err !== 'object') return false
  const e = err as { code?: unknown; constraint?: unknown; cause?: unknown }
  if (e.code !== '23505') return e.cause !== err && isUniqueViolation(e.cause, constraint)
  return constraint ? e.constraint === constraint : true
}
