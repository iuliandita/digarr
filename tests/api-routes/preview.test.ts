// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../helpers/test-app'

vi.mock('@/core/sessions', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 1,
    token: 'tok',
    expiresAt: new Date(Date.now() + 86400000),
  }),
}))

const CLIP = 'https://audio-ssl.itunes.apple.com/itunes-assets/a/b/preview.m4a'
const auth = { headers: { Authorization: 'Bearer tok' } }

function stubItunes(results: unknown[]) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify({ results })))
}

afterEach(() => vi.restoreAllMocks())

describe('API routes: Apple preview lookup', () => {
  it('returns songs with only trackId, trackName, artistName and previewUrl', async () => {
    stubItunes([
      {
        wrapperType: 'track',
        kind: 'song',
        trackId: 5,
        trackName: 'Glory Box',
        artistName: 'Portishead',
        previewUrl: CLIP,
        trackViewUrl: 'https://music.apple.com/us/album/x/5?i=5',
      },
    ])
    const { app } = createTestApp()
    const res = await app.request('/api/v1/preview/apple?name=Portishead&id=7', auth)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({
      songs: [{ trackId: 5, trackName: 'Glory Box', artistName: 'Portishead', previewUrl: CLIP }],
    })
  })

  it('returns a reason instead of songs when nothing matches', async () => {
    stubItunes([])
    const { app } = createTestApp()
    const res = await app.request('/api/v1/preview/apple?name=Portishead', auth)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ songs: null, reason: 'no-match' })
  })

  it('answers invalid input with a validation problem', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { app } = createTestApp()
    const res = await app.request('/api/v1/preview/apple?name=Portishead&id=7a', auth)
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
