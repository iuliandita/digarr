// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { initEncryption } from '@/core/crypto'
import type { Database } from '@/db'
import { upsertOAuthToken } from '@/db/queries/oauth-tokens'

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
    returning: vi.fn(async () => [
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
  it('encrypts every secret column, including on the conflict update', async () => {
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
    expect(capture.updateSet?.accessToken).toBe(values?.accessToken)
    expect(capture.updateSet?.clientSecret).toBe(values?.clientSecret)
  })

  it('round-trips the plaintext back to the caller', async () => {
    const capture: UpsertCapture = {}
    const db = makeDb(capture)

    const row = await upsertOAuthToken(db, {
      userId: 1,
      provider: 'spotify',
      accessToken: 'real-access-token',
      refreshToken: 'real-refresh-token',
      expiresAt: new Date(Date.now() + 3600_000),
      clientId: 'client-id-plain',
      clientSecret: 'client-secret-plain',
      scopes: 'read',
    })

    expect(row.accessToken).toBe('real-access-token')
    expect(row.clientSecret).toBe('client-secret-plain')
  })
})
