// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { BlockedArtistRow } from '@/db/queries/artist-blocks'
import { createApp } from '@/server'
import { makeDeps } from '../../helpers/test-app'

const SESSION_TOKEN = 'artist-blocks-token'

async function authed(): Promise<Headers> {
  await createSession(1, SESSION_TOKEN)
  return new Headers({ Authorization: `Bearer ${SESSION_TOKEN}` })
}

beforeEach(async () => {
  await clearAllSessions()
  vi.clearAllMocks()
})

describe('GET /api/v1/artist-blocks', () => {
  it('returns the user blocks with serialized blockedAt + null cursor', async () => {
    const row: BlockedArtistRow = {
      artistId: 10,
      name: 'Artist A',
      mbid: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      reason: 'already_own',
      reasonText: null,
      blockedAt: new Date('2026-04-25T12:00:00Z'),
    }
    const listArtistBlocks = vi.fn(async () => ({ items: [row], nextCursor: null }))
    const app = createApp(makeDeps({ listArtistBlocks }))
    const res = await app.request('/api/v1/artist-blocks', { headers: await authed() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; nextCursor: null }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.blockedAt).toBe('2026-04-25T12:00:00.000Z')
    expect(body.nextCursor).toBeNull()
  })

  it('forwards limit and q query params', async () => {
    const listArtistBlocks = vi.fn(async () => ({ items: [], nextCursor: null }))
    const app = createApp(makeDeps({ listArtistBlocks }))
    const res = await app.request('/api/v1/artist-blocks?limit=10&q=metal', {
      headers: await authed(),
    })
    expect(res.status).toBe(200)
    expect(listArtistBlocks).toHaveBeenCalledWith({
      userId: 1,
      limit: 10,
      cursor: null,
      q: 'metal',
    })
  })

  it('returns 400 when limit is not an integer', async () => {
    const listArtistBlocks = vi.fn(async () => ({ items: [], nextCursor: null }))
    const app = createApp(makeDeps({ listArtistBlocks }))
    const res = await app.request('/api/v1/artist-blocks?limit=abc', {
      headers: await authed(),
    })
    expect(res.status).toBe(400)
    expect(listArtistBlocks).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/artist-blocks')
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/v1/artist-blocks/:artistId', () => {
  it('returns 204 (idempotent)', async () => {
    const removeArtistBlock = vi.fn(async () => true)
    const app = createApp(makeDeps({ removeArtistBlock }))
    const res = await app.request('/api/v1/artist-blocks/42', {
      method: 'DELETE',
      headers: await authed(),
    })
    expect(res.status).toBe(204)
    expect(removeArtistBlock).toHaveBeenCalledWith({ userId: 1, artistId: 42 })
  })

  it('returns 400 on invalid id', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/artist-blocks/notanid', {
      method: 'DELETE',
      headers: await authed(),
    })
    expect(res.status).toBe(400)
  })

  it('rejects fractional ids before deleting', async () => {
    const removeArtistBlock = vi.fn(async () => true)
    const app = createApp(makeDeps({ removeArtistBlock }))
    const res = await app.request('/api/v1/artist-blocks/1.5', {
      method: 'DELETE',
      headers: await authed(),
    })
    expect(res.status).toBe(400)
    expect(removeArtistBlock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/artist-blocks', () => {
  it('creates a block for the authed user', async () => {
    const addArtistBlock = vi.fn(async () => {})
    const app = createApp(makeDeps({ addArtistBlock }))
    const res = await app.request('/api/v1/artist-blocks', {
      method: 'POST',
      headers: { ...Object.fromEntries(await authed()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId: 99, reason: 'wrong_style' }),
    })
    expect(res.status).toBe(204)
    expect(addArtistBlock).toHaveBeenCalledWith({
      userId: 1,
      artistId: 99,
      reason: 'wrong_style',
      reasonText: null,
    })
  })

  it('rejects invalid bodies (400)', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/artist-blocks', {
      method: 'POST',
      headers: { ...Object.fromEntries(await authed()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId: 'oops' }),
    })
    expect(res.status).toBe(400)
  })
})
