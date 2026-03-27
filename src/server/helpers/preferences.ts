import type { Database } from '@/db'
import { getUserById, type UserPublic } from '@/db/queries/users'

/**
 * Resolve per-user preferences with fallback to global.
 * Returns the user's preferences if they exist and are non-empty,
 * otherwise returns the global preferences unchanged.
 *
 * Accepts either a Database instance (calls getUserById internally)
 * or a pre-bound lookup function (for routes using AppDependencies).
 */
export async function resolveUserPreferences(
  dbOrLookup: Database | ((id: number) => Promise<UserPublic | null>),
  globalPrefs: Record<string, unknown> | null,
  userId?: number,
): Promise<Record<string, unknown> | null> {
  if (!userId) return globalPrefs
  const user =
    typeof dbOrLookup === 'function'
      ? await dbOrLookup(userId)
      : await getUserById(dbOrLookup, userId)
  if (user?.preferences && Object.keys(user.preferences as Record<string, unknown>).length > 0) {
    return user.preferences as Record<string, unknown>
  }
  return globalPrefs
}
