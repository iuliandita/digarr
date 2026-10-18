import type { Database } from '@/db'
import { getUserById, type UserPublic } from '@/db/queries/users'
import type { Preferences } from '@/db/schema'

/**
 * Resolve per-user preferences with fallback to global.
 * Personal notification channels do not replace discovery settings.
 * Discovery preferences keep their existing per-user fallback behavior,
 * while scan notifications use the shared channels.
 *
 * Accepts either a Database instance (calls getUserById internally)
 * or a pre-bound lookup function (for routes using AppDependencies).
 */
export async function resolveUserPreferences(
  dbOrLookup: Database | ((id: number) => Promise<UserPublic | null>),
  globalPrefs: Partial<Preferences> | null,
  userId?: number,
): Promise<Partial<Preferences> | null> {
  if (!userId) return globalPrefs
  const user =
    typeof dbOrLookup === 'function'
      ? await dbOrLookup(userId)
      : await getUserById(dbOrLookup, userId)
  if (user?.preferences) {
    const { channels: _personalChannels, ...preferences } = user.preferences
    if (Object.keys(preferences).length > 0) {
      return {
        ...preferences,
        ...(globalPrefs?.channels !== undefined ? { channels: globalPrefs.channels } : {}),
      }
    }
  }
  return globalPrefs
}
