import type { SessionStore } from '@/db/queries/sessions'
import { SESSION_TTL_MS } from '@/db/queries/sessions'

// In-memory fallback for tests and boot-time before DB is ready
const memSessions = new Map<string, { userId: number; createdAt: number }>()

// Cache raw tokens per user so proxy-auth can retrieve them after DB stores hashes
const rawTokenByUser = new Map<number, { token: string; createdAt: number }>()

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
  rawTokenByUser.set(userId, { token, createdAt: Date.now() })
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
  rawTokenByUser.delete(userId)
  if (dbStore) {
    await dbStore.deleteForUser(userId)
  } else {
    for (const [t, s] of memSessions) {
      if (s.userId === userId) memSessions.delete(t)
    }
  }
}

export async function getActiveSessionForUser(userId: number): Promise<string | null> {
  // Check raw-token cache first (needed because DB stores hashed tokens)
  const cached = rawTokenByUser.get(userId)
  if (cached && Date.now() - cached.createdAt < SESSION_TTL_MS) {
    const session = await getSession(cached.token)
    if (session) return cached.token
    rawTokenByUser.delete(userId)
  }
  if (!dbStore) {
    for (const [t, s] of memSessions) {
      if (s.userId === userId && Date.now() - s.createdAt < SESSION_TTL_MS) return t
    }
  }
  return null
}

/** Visible for testing. */
export async function clearAllSessions(): Promise<void> {
  rawTokenByUser.clear()
  if (dbStore) {
    await dbStore.clear()
  } else {
    memSessions.clear()
  }
}
