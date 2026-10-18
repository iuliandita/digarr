// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAudioMuseClient, normalizeAudioMuseArtists } from '@/core/clients/audiomuse'
import fixture from '../../fixtures/audiomuse/v3.6.4.json'

afterEach(() => vi.unstubAllGlobals())

describe('AudioMuse-AI v3.6.4 contract', () => {
  it.each([undefined, 'private-token'])(
    'queries by name with n and optional Bearer auth (%s)',
    async (token) => {
      const fetch = vi.fn().mockResolvedValue(Response.json(fixture.artists))
      vi.stubGlobal('fetch', fetch)
      const client = createAudioMuseClient({
        url: 'https://audiomuse.example/music/',
        token,
        skipTlsVerify: true,
      })
      const result = await client.getSimilarArtists('Björk & friends')
      const [url, init] = fetch.mock.calls[0] ?? []
      expect(new URL(url).pathname).toBe('/music/api/similar_artists')
      expect([...new URL(url).searchParams]).toEqual([
        ['artist', 'Björk & friends'],
        ['n', '20'],
      ])
      expect(init.headers.get('Authorization')).toBe(token ? `Bearer ${token}` : null)
      expect(init.redirect).toBe('manual')
      expect(init.tls).toEqual({ rejectUnauthorized: false })
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(result).toEqual([
        { name: 'Portishead', similarityScore: 0.8, source: 'audiomuse' },
        { name: 'Massive Attack', similarityScore: 0.4, source: 'audiomuse' },
        { name: 'Tricky', similarityScore: 0.25, source: 'audiomuse' },
      ])
      expect(result[0]).not.toHaveProperty('mbid')
    },
  )

  it.each([
    [404, fixture.unknownArtist, 'artist_unknown'],
    [503, fixture.notIndexed, 'not_indexed'],
    [401, fixture.unauthorized, 'authentication_required'],
    [503, { error_code: 4001 }, 'unreachable'],
    [500, { error_code: 3003 }, 'unreachable'],
    [404, '<html>proxy missing route</html>', 'request_failed'],
    [302, '', 'request_failed'],
    [200, { artists: fixture.artists }, 'invalid_response'],
    [200, [], 'artist_unknown'],
  ])('maps HTTP %s to %s without retries or upstream text', async (status, body, reason) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
      )
    vi.stubGlobal('fetch', fetch)
    await expect(
      createAudioMuseClient({ url: 'https://audiomuse.example' }).getSimilarArtists('Radiohead'),
    ).rejects.toMatchObject({ reason, message: `AudioMuse-AI: ${reason}` })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('maps a timeout or network failure to unreachable without exposing tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-token')))
    await expect(
      createAudioMuseClient({
        url: 'https://audiomuse.example',
        token: 'private-token',
      }).getSimilarArtists('Radiohead'),
    ).rejects.toThrow('AudioMuse-AI: unreachable')
  })

  it.each([
    null,
    {},
    [{ artist: 'A', divergence: -1 }],
    [{ artist: 'A', divergence: NaN }],
    [{ artist: 'A', divergence: Infinity }],
    [{ artist: '', divergence: 0 }],
    [{ artist: 'A', divergence: '0.5' }],
  ])('rejects malformed results: %j', (body) => {
    expect(() => normalizeAudioMuseArtists(body)).toThrow('invalid_response')
  })

  it('normalizes zero divergence and unbounded distances without mistaking server IDs for MBIDs', () => {
    expect(
      normalizeAudioMuseArtists([
        { artist: ' A ', artist_id: 'server-id', divergence: 0 },
        { artist: 'B', divergence: 1000 },
      ]).map((a) => a.similarityScore),
    ).toEqual([1, 1 / 1001])
  })

  it('probes the authenticated version route without needing an indexed seed', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(fixture.version))
    vi.stubGlobal('fetch', fetch)
    expect(
      await createAudioMuseClient({ url: 'https://audiomuse.example' }).testConnection(),
    ).toEqual({ success: true, message: 'AudioMuse-AI', details: { version: 'v3.6.4' } })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://audiomuse.example/api/version')
    expect(fetch.mock.calls[0]?.[1].tls).toBeUndefined()
  })

  it.each([
    'file:///etc/passwd',
    'http://user:secret@example.com',
    'http://169.254.169.254',
    'http://metadata.google.internal',
    'http://example.com/?token=secret',
  ])('rejects an unsafe connection URL %s', (url) => {
    expect(() => createAudioMuseClient({ url })).toThrow()
  })
})
