import type { SessionStore } from '@/db/queries/sessions'
import { SESSION_TTL_MS } from '@/db/queries/sessions'

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

/** Visible for testing. */
export async function clearAllSessions(): Promise<void> {
  if (dbStore) {
    await dbStore.clear()
  } else {
    memSessions.clear()
  }
}
