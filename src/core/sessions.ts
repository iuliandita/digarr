import type { SessionStore } from '@/db/queries/sessions'
import { SESSION_TTL_MS, SessionRotationConflictError } from '@/db/queries/sessions'

export { SessionRotationConflictError }

// In-memory fallback for tests and boot-time before DB is ready
const memSessions = new Map<string, { userId: number; createdAt: number }>()

let dbStore: SessionStore | null = null

export function setSessionStore(store: SessionStore): void {
  dbStore = store
}

export async function createSession(userId: number, token: string): Promise<void> {
  if (dbStore) {
    await dbStore.create(token, userId)
  } else {
    memSessions.set(token, { userId, createdAt: Date.now() })
  }
}

export async function getSession(token: string): Promise<{ userId: number } | null> {
  if (dbStore) {
    return dbStore.get(token)
  }
  const session = memSessions.get(token)
  if (!session) return null
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    memSessions.delete(token)
    return null
  }
  return { userId: session.userId }
}

export async function deleteSession(token: string): Promise<void> {
  if (dbStore) {
    await dbStore.delete(token)
  } else {
    memSessions.delete(token)
  }
}

export async function clearUserSessions(userId: number): Promise<void> {
  if (dbStore) {
    await dbStore.deleteForUser(userId)
  } else {
    for (const [t, s] of memSessions) {
      if (s.userId === userId) memSessions.delete(t)
    }
  }
}

export async function replaceSession(
  userId: number,
  newToken: string,
  requiredSourceToken: string,
  revokedTokens: string[],
): Promise<void> {
  if (dbStore) {
    await dbStore.replace(userId, newToken, requiredSourceToken, revokedTokens)
  } else {
    const source = memSessions.get(requiredSourceToken)
    if (
      newToken === requiredSourceToken ||
      source?.userId !== userId ||
      memSessions.has(newToken)
    ) {
      throw new SessionRotationConflictError()
    }

    memSessions.delete(requiredSourceToken)
    for (const token of new Set(revokedTokens)) {
      if (token !== newToken && token !== requiredSourceToken) memSessions.delete(token)
    }
    memSessions.set(newToken, { userId, createdAt: Date.now() })
  }
}

/** Visible for testing. */
export async function clearAllSessions(): Promise<void> {
  if (dbStore) {
    await dbStore.clear()
  } else {
    memSessions.clear()
  }
}
