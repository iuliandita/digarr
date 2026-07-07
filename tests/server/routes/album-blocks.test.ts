// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllSessions, createSession } from '@/core/sessions'
import type { BlockedAlbumRow } from '@/db/queries/album-blocks'
import { createApp } from '@/server'
import { makeDeps } from '../../helpers/test-app'

const SESSION_TOKEN = 'album-blocks-token'

async function authed(): Promise<Headers> {
  await createSession(1, SESSION_TOKEN)
  return new Headers({ Authorization: `Bearer ${SESSION_TOKEN}` })
}

beforeEach(async () => {
  await clearAllSessions()
  vi.clearAllMocks()
})

describe('GET /api/v1/album-blocks', () => {
  it('returns the user blocks with serialized blockedAt', async () => {
    const row: BlockedAlbumRow = {
      id: 1,
      artistId: 10,
      artistName: 'Artist A',
      artistMbid: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      releaseGroupMbid: 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
      reason: 'already_own',
      reasonText: null,
      blockedAt: new Date('2026-04-25T12:00:00Z'),
    }
    const listAlbumBlocks = vi.fn(async () => [row])
    const app = createApp(makeDeps({ listAlbumBlocks }))
    const res = await app.request('/api/v1/album-blocks', { headers: await authed() })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.blockedAt).toBe('2026-04-25T12:00:00.000Z')
    expect(body.items[0]?.releaseGroupMbid).toBe('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb')
    expect(listAlbumBlocks).toHaveBeenCalledWith(1)
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/album-blocks')
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/v1/album-blocks/:releaseGroupMbid', () => {
  it('returns 204 and forwards the userId + mbid', async () => {
    const removeAlbumBlock = vi.fn(async () => {})
    const app = createApp(makeDeps({ removeAlbumBlock }))
    const mbid = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb'
    const res = await app.request(`/api/v1/album-blocks/${mbid}`, {
      method: 'DELETE',
      headers: await authed(),
    })
    expect(res.status).toBe(204)
    expect(removeAlbumBlock).toHaveBeenCalledWith({ userId: 1, releaseGroupMbid: mbid })
  })

  it('returns 400 on an invalid mbid', async () => {
    const removeAlbumBlock = vi.fn(async () => {})
    const app = createApp(makeDeps({ removeAlbumBlock }))
    const res = await app.request('/api/v1/album-blocks/not-a-uuid', {
      method: 'DELETE',
      headers: await authed(),
    })
    expect(res.status).toBe(400)
    expect(removeAlbumBlock).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    const app = createApp(makeDeps())
    const res = await app.request('/api/v1/album-blocks/bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })
})
