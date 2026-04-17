/**
 * Postgres error helpers used by the application layer.
 *
 * Keep this file tiny. It exists so the three admin-creation sites
 * (register, proxy-auth, oidc callback) can detect the unique-partial-index
 * collision that the 0026_single_admin_partial_index migration installs
 * without duplicating the predicate at each call site.
 */

/**
 * Detect a unique-violation on the `users_single_admin` partial index.
 *
 * The Postgres driver surfaces these with `code === '23505'` and
 * `constraint === 'users_single_admin'`. We check both so that unrelated
 * unique-violations (for example the `users_username_unique` constraint)
 * propagate as real errors.
 */
export function isSingleAdminCollision(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const e = err as { code?: unknown; constraint?: unknown }
  return e.code === '23505' && e.constraint === 'users_single_admin'
}
