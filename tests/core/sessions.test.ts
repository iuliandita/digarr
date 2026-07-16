import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAllSessions,
  clearUserSessions,
  createSession,
  deleteSession,
  getSession,
  replaceSession,
  resetUserSession,
  SessionRotationConflictError,
} from '@/core/sessions'

afterEach(async () => {
  await clearAllSessions()
})

describe('session store', () => {
  it('stores and retrieves a session', async () => {
    await createSession(42, 'token-abc')
    const session = await getSession('token-abc')
    expect(session).not.toBeNull()
    expect(session?.userId).toBe(42)
  })

  it('returns null for unknown token', async () => {
    expect(await getSession('nonexistent')).toBeNull()
  })

  it('deletes a session', async () => {
    await createSession(1, 'token-del')
    await deleteSession('token-del')
    expect(await getSession('token-del')).toBeNull()
  })

  it('clears all sessions for a user', async () => {
    await createSession(1, 'token-a')
    await createSession(1, 'token-b')
    await createSession(2, 'token-c')

    await clearUserSessions(1)

    expect(await getSession('token-a')).toBeNull()
    expect(await getSession('token-b')).toBeNull()
    expect(await getSession('token-c')).not.toBeNull()
  })

  it('clearAllSessions removes everything', async () => {
    await createSession(1, 'token-1')
    await createSession(2, 'token-2')

    await clearAllSessions()

    expect(await getSession('token-1')).toBeNull()
    expect(await getSession('token-2')).toBeNull()
  })

  it('replaces revoked sessions while preserving the fresh token', async () => {
    await createSession(1, 'token-old-a')
    await createSession(2, 'token-old-b')

    await replaceSession(1, 'token-fresh', 'token-old-a', [
      'token-old-a',
      'token-fresh',
      'token-old-b',
      'token-old-a',
    ])

    expect(await getSession('token-old-a')).toBeNull()
    expect(await getSession('token-old-b')).toBeNull()
    expect(await getSession('token-fresh')).toEqual({ userId: 1 })
  })

  it('rejects a consumed source without changing optional or replacement sessions', async () => {
    await createSession(1, 'source-token')
    await createSession(1, 'optional-token')
    await replaceSession(1, 'first-fresh', 'source-token', [])

    await expect(
      replaceSession(1, 'second-fresh', 'source-token', ['optional-token']),
    ).rejects.toBeInstanceOf(SessionRotationConflictError)

    expect(await getSession('first-fresh')).toEqual({ userId: 1 })
    expect(await getSession('optional-token')).toEqual({ userId: 1 })
    expect(await getSession('second-fresh')).toBeNull()
  })

  it('rejects a source owned by another user', async () => {
    await createSession(2, 'other-user-source')
    await createSession(1, 'optional-token')

    await expect(
      replaceSession(1, 'replacement-token', 'other-user-source', ['optional-token']),
    ).rejects.toBeInstanceOf(SessionRotationConflictError)

    expect(await getSession('other-user-source')).toEqual({ userId: 2 })
    expect(await getSession('optional-token')).toEqual({ userId: 1 })
    expect(await getSession('replacement-token')).toBeNull()
  })

  it('resets one user without clearing another user session', async () => {
    await createSession(1, 'user-one-old')
    await createSession(2, 'user-two-token')

    await resetUserSession(1, 'user-one-fresh')

    expect(await getSession('user-one-old')).toBeNull()
    expect(await getSession('user-one-fresh')).toEqual({ userId: 1 })
    expect(await getSession('user-two-token')).toEqual({ userId: 2 })
  })
})
