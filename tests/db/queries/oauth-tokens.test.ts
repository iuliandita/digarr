// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { initEncryption } from '@/core/crypto'
import type { Database } from '@/db'
import { findPendingOAuthByState, upsertOAuthToken } from '@/db/queries/oauth-tokens'

const TEST_KEY = 'oauth-tokens-test-key-do-not-reuse'

beforeAll(() => {
  initEncryption(TEST_KEY)
})

afterAll(() => {
  initEncryption(undefined)
})

type UpsertCapture = {
  insertValues?: Record<string, unknown>
  updateSet?: Record<string, unknown>
}

function makeDb(capture: UpsertCapture): Database {
  const chain = {
    values: vi.fn((values: Record<string, unknown>) => {
      capture.insertValues = values
      return chain
    }),
    onConflictDoUpdate: vi.fn((args: { set: Record<string, unknown> }) => {
      capture.updateSet = args.set
      return chain
    }),
    returning: vi.fn().mockResolvedValue([
      {
        id: 1,
        userId: 1,
        provider: 'spotify',
        accessToken: capture.insertValues?.accessToken ?? '',
        refreshToken: capture.insertValues?.refreshToken ?? null,
        expiresAt: new Date(),
        scopes: capture.insertValues?.scopes ?? null,
        clientId: capture.insertValues?.clientId ?? null,
        clientSecret: capture.insertValues?.clientSecret ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
  }
  return { insert: vi.fn().mockReturnValue(chain) } as unknown as Database
}

describe('upsertOAuthToken encryption', () => {
  it('encrypts clientSecret even when accessToken is a pending marker', async () => {
    const capture: UpsertCapture = {}
    const db = makeDb(capture)

    await upsertOAuthToken(db, {
      userId: 1,
      provider: 'spotify',
      accessToken: 'pending:1:state-token',
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60_000),
      clientId: 'client-id-plain',
      clientSecret: 'client-secret-plain',
      scopes: 'read',
    })

    const values = capture.insertValues
    expect(values).toBeDefined()
    // Access token must remain plaintext for LIKE-prefix lookup
    expect(values?.accessToken).toBe('pending:1:state-token')
    // Client secret must be encrypted even during the pending window
    expect(values?.clientSecret).toEqual(expect.stringMatching(/^enc:v1:/))
    expect(values?.clientSecret).not.toBe('client-secret-plain')
  })

  it('encrypts clientSecret on non-pending upsert', async () => {
    const capture: UpsertCapture = {}
    const db = makeDb(capture)

    await upsertOAuthToken(db, {
      userId: 1,
      provider: 'spotify',
      accessToken: 'real-access-token',
      refreshToken: 'real-refresh-token',
      expiresAt: new Date(Date.now() + 3600_000),
      clientId: 'client-id-plain',
      clientSecret: 'client-secret-plain',
      scopes: 'read write',
    })

    const values = capture.insertValues
    expect(values?.accessToken).toEqual(expect.stringMatching(/^enc:v1:/))
    expect(values?.refreshToken).toEqual(expect.stringMatching(/^enc:v1:/))
    expect(values?.clientSecret).toEqual(expect.stringMatching(/^enc:v1:/))
  })
})

describe('findPendingOAuthByState encryption', () => {
  it('decrypts pending OAuth credentials used by provider callbacks', async () => {
    const capture: UpsertCapture = {}
    const db = makeDb(capture)
    const expiresAt = new Date(Date.now() + 60_000)

    await upsertOAuthToken(db, {
      userId: 1,
      provider: 'spotify',
      accessToken: 'pending:1:state-token',
      refreshToken: 'https://app.example.com/api/v1/auth/oauth/spotify/callback',
      expiresAt,
      clientId: 'client-id-plain',
      clientSecret: 'client-secret-plain',
      scopes: 'read',
    })

    const rows = [
      {
        id: 1,
        userId: 1,
        provider: 'spotify',
        accessToken: capture.insertValues?.accessToken ?? '',
        refreshToken: capture.insertValues?.refreshToken ?? null,
        expiresAt,
        scopes: 'read',
        clientId: 'client-id-plain',
        clientSecret: capture.insertValues?.clientSecret ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]
    const selectChain = {
      from: vi.fn(() => selectChain),
      where: vi.fn().mockResolvedValue(rows),
    }
    const lookupDb = { select: vi.fn(() => selectChain) } as unknown as Database

    const pending = await findPendingOAuthByState(lookupDb, 'spotify', 'state-token')

    expect(pending?.accessToken).toBe('pending:1:state-token')
    expect(pending?.refreshToken).toBe('https://app.example.com/api/v1/auth/oauth/spotify/callback')
    expect(pending?.clientSecret).toBe('client-secret-plain')
  })
})
