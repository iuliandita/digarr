// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { initEncryption } from '@/core/crypto'
import type { Database } from '@/db'
import {
  consumePendingOAuth,
  createPendingOAuth,
  hashOAuthValue,
  pendingBindingMatches,
} from '@/db/queries/oauth-pending'

const TEST_KEY = 'oauth-pending-test-key-do-not-reuse'

beforeAll(() => {
  initEncryption(TEST_KEY)
})

afterAll(() => {
  initEncryption(undefined)
})

type InsertCapture = { values?: Record<string, unknown>; deletedBeforeInsert?: boolean }

function makeInsertDb(capture: InsertCapture): Database {
  const deleteChain = {
    where: vi.fn(async () => {
      capture.deletedBeforeInsert = capture.values === undefined
    }),
  }
  const insertChain = {
    values: vi.fn(async (values: Record<string, unknown>) => {
      capture.values = values
    }),
  }
  const tx = {
    delete: vi.fn(() => deleteChain),
    insert: vi.fn(() => insertChain),
  }
  return {
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)),
  } as unknown as Database
}

function makeConsumeDb(row: Record<string, unknown> | undefined): Database {
  const chain = {
    where: vi.fn(() => chain),
    returning: vi.fn(async () => (row ? [row] : [])),
  }
  return { delete: vi.fn(() => chain) } as unknown as Database
}

describe('createPendingOAuth', () => {
  it('stores digests of the state and browser binding, never the raw values', async () => {
    const capture: InsertCapture = {}
    await createPendingOAuth(makeInsertDb(capture), {
      userId: 7,
      provider: 'tidal',
      state: 'raw-state',
      binding: 'raw-binding',
      payload: { redirectUri: 'https://app.example/cb', codeVerifier: 'verifier' },
      clientSecret: 'client-secret-plain',
    })

    const values = capture.values
    expect(values?.stateHash).toBe(hashOAuthValue('raw-state'))
    expect(values?.bindingHash).toBe(hashOAuthValue('raw-binding'))
    expect(JSON.stringify(values)).not.toContain('raw-state')
    expect(JSON.stringify(values)).not.toContain('raw-binding')
  })

  it('encrypts the payload and client secret at rest', async () => {
    const capture: InsertCapture = {}
    await createPendingOAuth(makeInsertDb(capture), {
      userId: 7,
      provider: 'tidal',
      state: 's',
      binding: 'b',
      payload: { codeVerifier: 'verifier-plain' },
      clientSecret: 'client-secret-plain',
    })

    expect(capture.values?.payload).toEqual(expect.stringMatching(/^enc:v1:/))
    expect(capture.values?.clientSecret).toEqual(expect.stringMatching(/^enc:v1:/))
  })

  it('clears any earlier in-flight attempt before inserting', async () => {
    const capture: InsertCapture = {}
    await createPendingOAuth(makeInsertDb(capture), {
      userId: 7,
      provider: 'tidal',
      state: 's',
      binding: 'b',
    })
    expect(capture.deletedBeforeInsert).toBe(true)
  })
})

describe('consumePendingOAuth', () => {
  it('returns the decrypted row for a matching state', async () => {
    const capture: InsertCapture = {}
    await createPendingOAuth(makeInsertDb(capture), {
      userId: 7,
      provider: 'tidal',
      state: 'raw-state',
      binding: 'raw-binding',
      payload: { redirectUri: 'https://app.example/cb', codeVerifier: 'verifier-plain' },
      clientSecret: 'client-secret-plain',
    })

    const expiresAt = new Date(Date.now() + 60_000)
    const pending = await consumePendingOAuth(
      makeConsumeDb({ ...capture.values, id: 1, expiresAt, createdAt: new Date() }),
      'tidal',
      'raw-state',
    )

    expect(pending?.userId).toBe(7)
    expect(pending?.payload.codeVerifier).toBe('verifier-plain')
    expect(pending?.clientSecret).toBe('client-secret-plain')
    expect(pending?.expiresAt).toBe(expiresAt)
  })

  it('returns null when nothing matched', async () => {
    expect(await consumePendingOAuth(makeConsumeDb(undefined), 'tidal', 'nope')).toBeNull()
  })
})

describe('pendingBindingMatches', () => {
  it('accepts the binding that produced the stored hash', () => {
    expect(pendingBindingMatches(hashOAuthValue('binding'), 'binding')).toBe(true)
  })

  it('rejects a wrong or missing binding', () => {
    expect(pendingBindingMatches(hashOAuthValue('binding'), 'other')).toBe(false)
    expect(pendingBindingMatches(hashOAuthValue('binding'), undefined)).toBe(false)
    expect(pendingBindingMatches('', undefined)).toBe(false)
  })
})
