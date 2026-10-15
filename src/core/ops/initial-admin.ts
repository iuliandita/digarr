import { hashPassword } from '@/core/auth'
import type { Database } from '@/db'
import { createUser, getUserCount } from '@/db/queries/users'

type InitialAdminConfig = {
  initialUsername?: string
  initialPassword?: string
}

export async function bootstrapInitialAdmin(
  db: Database,
  config: InitialAdminConfig,
): Promise<void> {
  if ((await getUserCount(db)) > 0) return

  const { initialUsername, initialPassword } = config
  if (!initialUsername && !initialPassword) return
  if (!initialUsername || !initialPassword) {
    throw new Error('DIGARR_INITIAL_USERNAME and DIGARR_INITIAL_PASSWORD must both be set')
  }
  if (initialPassword.length < 12) {
    throw new Error('DIGARR_INITIAL_PASSWORD must be at least 12 characters')
  }

  const user = await createUser(
    db,
    { username: initialUsername, passwordHash: hashPassword(initialPassword) },
    { bootstrap: 'first-user-only' },
  )
  if (user.username !== initialUsername || !user.isAdmin) {
    throw new Error('Initial admin creation did not return the intended administrator')
  }
}
