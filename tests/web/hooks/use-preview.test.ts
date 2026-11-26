// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePreviewSource, usePreview } from '@/web/hooks/use-preview'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

// Mock fetch globally so Deezer API calls don't hit the network.
// In browsers, Deezer returns CORS errors; here we simulate that failure
// so tests are deterministic and don't depend on external services.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error (CORS)')))
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolvePreviewSource', () => {
  it('returns null for null streamingUrls', async () => {
    const result = await resolvePreviewSource(null, 'Radiohead')
    expect(result).toBeNull()
  })

  it('returns null for empty streamingUrls', async () => {
    const result = await resolvePreviewSource({}, 'Radiohead')
    expect(result).toBeNull()
  })

  it('resolves Spotify embed URL with autoPlay', async () => {
    const result = await resolvePreviewSource(
      { spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
      'Radiohead',
    )
    expect(result).not.toBeNull()
    expect(result?.type).toBe('spotify-embed')
    expect(result?.track).toBeUndefined()
    expect(result?.embedUrl).toContain('autoPlay=true')
  })

  it('resolves Spotify album embed URL with autoPlay', async () => {
    const result = await resolvePreviewSource(
      { spotify: 'https://open.spotify.com/album/6dVIqQ8qmQ5GBnJ9shOYGE' },
      'Radiohead',
    )
    expect(result).not.toBeNull()
    expect(result?.type).toBe('spotify-embed')
    expect(result?.embedUrl).toContain('autoPlay=true')
    expect(result?.embedUrl).toContain('/embed/album/')
  })

  it('resolves YouTube embed URL with autoplay when Deezer fails', async () => {
    const result = await resolvePreviewSource(
      { youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      'Rick Astley',
    )
    expect(result).not.toBeNull()
    expect(result?.type).toBe('youtube-embed')
    expect(result?.track).toBeUndefined()
    expect(result?.embedUrl).toContain('autoplay=1')
  })

  it.each([
    [{ name: '  RADIOHEAD  ' }, 'Creep', { artistName: '  RADIOHEAD  ', trackName: 'Creep' }],
    [{ name: 'Radiohead' }, '   ', undefined],
    [{ name: 'Radiohead' }, undefined, undefined],
    [{ name: 'Radiohead' }, 123, undefined],
  ])(
    'plays the exact-artist Deezer result and attaches only valid track metadata: %j / %j',
    async (artist, title, track) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ preview: 'https://cdn.example/p.mp3', artist, title }] }),
        }),
      )
      expect(await resolvePreviewSource({ deezer: 'url' }, 'Radiohead')).toEqual({
        type: 'deezer-audio',
        url: 'https://cdn.example/p.mp3',
        embedUrl: 'https://cdn.example/p.mp3',
        ...(track ? { track } : {}),
      })
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        'https://api.deezer.com/search?q=Radiohead&limit=25',
      )
    },
  )

  it('skips other artists in a plain Deezer search and never uses a non-exact match', async () => {
    const hit = (name: string, preview: string) => ({
      preview,
      title: 'Song',
      artist: { name },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            hit('Radiohead Tribute', 'https://cdn.example/x.mp3'),
            hit('Radiohead', 'https://cdn.example/r.mp3'),
          ],
        }),
      }),
    )
    expect((await resolvePreviewSource({ deezer: 'url' }, 'Radiohead'))?.url).toBe(
      'https://cdn.example/r.mp3',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [hit('Radiohead Tribute', 'https://cdn.example/x.mp3')] }),
      }),
    )
    expect(await resolvePreviewSource({ deezer: 'url' }, 'Boards of Canada')).toBeNull()
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://api.deezer.com/search?q=Boards%20of%20Canada&limit=25',
    )
  })

  describe('Apple previews', () => {
    const APPLE_PREVIEW = 'https://audio-ssl.itunes.apple.com/itunes-assets/a/b/preview.m4a'
    const artistRow = { wrapperType: 'artist', artistName: 'Radiohead' }
    const song = (artistName: string, trackName: unknown, previewUrl?: string) => ({
      wrapperType: 'track',
      kind: 'song',
      artistName,
      trackName,
      ...(previewUrl ? { previewUrl } : {}),
    })
    const stubApple = (results: unknown) =>
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results }) }),
      )
    const stubAppleByUrl = (byUrl: { search: unknown[]; lookup: unknown[] }) => {
      const fetchMock = vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.startsWith('https://itunes.apple.com/search')
            ? { results: byUrl.search }
            : url.startsWith('https://itunes.apple.com/lookup')
              ? { results: byUrl.lookup }
              : { data: [] },
      }))
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }
    const appleSource = (track?: { artistName: string; trackName: string }) => ({
      type: 'apple-audio',
      url: APPLE_PREVIEW,
      embedUrl: `/api/v1/preview/audio?url=${encodeURIComponent(APPLE_PREVIEW)}`,
      ...(track ? { track } : {}),
    })

    it.each([
      'https://music.apple.com/gb/artist/radiohead/657515',
      'https://music.apple.com/us/artist/657515',
      'https://music.apple.com/artist/657515',
      'https://itunes.apple.com/us/artist/id657515',
    ])('looks the artist up by the ID in %s instead of using Spotify', async (appleMusic) => {
      stubApple([artistRow, song('Radiohead & Friends', 'Creep', APPLE_PREVIEW)])
      expect(
        await resolvePreviewSource(
          { appleMusic, spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
          'Radiohead',
          { applePreviews: true },
        ),
      ).toEqual(appleSource({ artistName: 'Radiohead & Friends', trackName: 'Creep' }))
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        'https://itunes.apple.com/lookup?id=657515&entity=song&limit=10',
        { signal: expect.any(AbortSignal) },
      )
    })

    it.each([
      [undefined],
      ['https://music.apple.com/search?term=Radiohead'],
      ['https://example.com/us/artist/657515'],
      ['http://music.apple.com/us/artist/657515'],
    ])('searches artists by exact name when the link is %j, then looks up songs', async (link) => {
      const fetchMock = stubAppleByUrl({
        search: [
          { wrapperType: 'artist', artistName: 'Radiohead Tribute', artistId: 1 },
          { wrapperType: 'artist', artistName: '  RADIOHEAD ', artistId: 657515 },
        ],
        lookup: [artistRow, song('Radiohead', '   ', APPLE_PREVIEW)],
      })
      expect(
        await resolvePreviewSource(
          { ...(link ? { appleMusic: link } : {}), deezer: 'url' },
          'Radiohead',
          { applePreviews: true },
        ),
      ).toEqual(appleSource())
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://itunes.apple.com/search?term=Radiohead&media=music&entity=musicArtist&attribute=artistTerm&limit=10',
        'https://itunes.apple.com/lookup?id=657515&entity=song&limit=10',
      ])
    })

    it('finds an artist listed in its own script whose songs are credited romanized', async () => {
      const fetchMock = stubAppleByUrl({
        search: [
          { wrapperType: 'artist', artistName: '花冷え。', artistId: 1437484631 },
          { wrapperType: 'artist', artistName: 'HANABIE.', artistId: 1616591251 },
        ],
        lookup: [song('hanabie', 'We Love Sweets', APPLE_PREVIEW)],
      })
      expect(
        await resolvePreviewSource({ deezer: 'url' }, '花冷え。', { applePreviews: true }),
      ).toEqual(appleSource({ artistName: 'hanabie', trackName: 'We Love Sweets' }))
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        'https://itunes.apple.com/lookup?id=1437484631&entity=song&limit=10',
      )
    })

    it('does not guess when no artist has exactly that name', async () => {
      const fetchMock = stubAppleByUrl({
        search: [{ wrapperType: 'artist', artistName: 'Yorushika', artistId: 2 }],
        lookup: [song('Yorushika', 'Song', APPLE_PREVIEW)],
      })
      expect(
        await resolvePreviewSource({ deezer: 'url' }, 'ヨルシカ', { applePreviews: true }),
      ).toBeNull()
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/lookup'))).toBe(false)
    })

    it.each([
      ['no song matches', [artistRow, song('Radiohead Tribute', 'Creep', APPLE_PREVIEW)]],
      ['the match has no preview', [song('Radiohead', 'Creep')]],
      [
        'the preview is on an unexpected host',
        [song('Radiohead', 'Creep', 'https://evil.example/preview.m4a')],
      ],
      ['the response has no results', undefined],
    ])('never falls back to Spotify when %s', async (_case, results) => {
      stubApple(results)
      expect(
        await resolvePreviewSource(
          { spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
          'Radiohead',
          { applePreviews: true },
        ),
      ).toBeNull()
    })

    it('still falls back to YouTube', async () => {
      stubApple([])
      const result = await resolvePreviewSource(
        {
          spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
          youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        },
        'Radiohead',
        { applePreviews: true },
      )
      expect(result?.type).toBe('youtube-embed')
    })

    it('does not contact Apple unless the preference is on', async () => {
      stubApple([song('Radiohead', 'Creep', APPLE_PREVIEW)])
      const result = await resolvePreviewSource(
        {
          appleMusic: 'https://music.apple.com/us/artist/657515',
          spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
        },
        'Radiohead',
      )
      expect(result?.type).toBe('spotify-embed')
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('returns null for invalid Spotify URL with no fallbacks', async () => {
    const result = await resolvePreviewSource(
      { spotify: 'https://open.spotify.com/invalid' },
      'Radiohead',
    )
    expect(result).toBeNull()
  })

  it('rejects a Spotify-shaped path on an untrusted host', async () => {
    const result = await resolvePreviewSource(
      { spotify: 'https://example.com/spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' },
      'Radiohead',
    )
    expect(result).toBeNull()
  })
})

// Engine-level coverage for the audition-queue surface: play() outcomes,
// playbackEndedCount, and toast suppression.

class FakeAudio {
  static instances: FakeAudio[] = []
  static playImpl: () => Promise<void> = () => Promise.resolve()
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  src: string
  volume = 1
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
  play() {
    return FakeAudio.playImpl()
  }
  pause() {}
}

function stubDeezerFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const artistName = new URL(url).searchParams.get('q') ?? ''
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              preview: 'https://cdn.example/p.mp3',
              title: 'Creep',
              artist: { id: 1, name: artistName },
            },
          ],
        }),
      }
    }),
  )
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(I18nProvider, null, children)

describe('usePreview play outcomes', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    FakeAudio.playImpl = () => Promise.resolve()
    vi.stubGlobal('Audio', FakeAudio)
  })

  it("waits for Spotify's playback event before marking an embed as playing", async () => {
    const { result } = renderHook(() => usePreview(), { wrapper })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', {
        spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
      })
    })
    expect(outcome).toBe('started')
    expect(result.current.state.playing).toBe(false)
    expect(result.current.state.source?.type).toBe('spotify-embed')
    expect(result.current.spotifyCommand.action).toBe('play')

    act(() => {
      result.current.onSpotifyPlaybackStarted()
    })
    expect(result.current.state.playing).toBe(true)

    act(() => {
      result.current.onSpotifyPlaybackPaused()
    })
    expect(result.current.state.playing).toBe(false)

    act(() => {
      result.current.onSpotifyPlaybackStarted()
    })

    act(() => {
      result.current.onSpotifyPlaybackEnded()
    })
    expect(result.current.state.playing).toBe(false)
    expect(result.current.playbackEndedCount).toBe(1)
  })

  it('routes Spotify pause and resume through controller commands', async () => {
    const { result } = renderHook(() => usePreview(), { wrapper })

    await act(async () => {
      await result.current.play('m1', 'Radiohead', {
        spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
      })
    })
    act(() => {
      result.current.onSpotifyPlaybackStarted()
    })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', {
        spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
      })
    })
    expect(outcome).toBe('paused')
    expect(result.current.spotifyCommand.action).toBe('pause')

    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', {
        spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
      })
    })
    expect(outcome).toBe('resumed')
    expect(result.current.spotifyCommand.action).toBe('play')
    expect(result.current.state.playing).toBe(false)
  })

  it('marks an unavailable Spotify controller as completed for queue recovery', async () => {
    const { result } = renderHook(() => usePreview(), { wrapper })

    await act(async () => {
      await result.current.play('m1', 'Radiohead', {
        spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
      })
    })
    act(() => result.current.onSpotifyPlaybackUnavailable())

    expect(result.current.state.playing).toBe(false)
    expect(result.current.playbackEndedCount).toBe(1)
    expect(result.current.getLastFailure()).toMatchObject({
      artistMbid: 'm1',
      reason: 'controller-unavailable',
    })
  })

  it("returns 'started', then 'paused', then 'resumed' for the same deezer artist", async () => {
    stubDeezerFetch()
    const { result } = renderHook(() => usePreview(), { wrapper })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    expect(outcome).toBe('started')
    expect(result.current.state.source?.track).toEqual({
      artistName: 'Radiohead',
      trackName: 'Creep',
    })

    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    expect(outcome).toBe('paused')
    expect(result.current.state.playing).toBe(false)

    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    expect(outcome).toBe('resumed')
    expect(result.current.state.playing).toBe(true)
  })

  it('plays an Apple preview through the audio proxy, with pause and resume', async () => {
    const previewUrl = 'https://audio-ssl.itunes.apple.com/itunes-assets/a/b/preview.m4a'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              wrapperType: 'track',
              kind: 'song',
              artistName: 'Radiohead',
              trackName: 'Creep',
              previewUrl,
            },
          ],
        }),
      }),
    )
    const urls = {
      appleMusic: 'https://music.apple.com/gb/artist/radiohead/657515',
      spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
    }
    const { result } = renderHook(() => usePreview({ applePreviews: true }), { wrapper })
    expect(result.current.hasPreview({ spotify: urls.spotify })).toBe(false)
    expect(result.current.hasPreview({ appleMusic: urls.appleMusic })).toBe(true)

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', urls)
    })
    expect(outcome).toBe('started')
    expect(result.current.state.source?.type).toBe('apple-audio')
    expect(result.current.state.playing).toBe(true)
    expect(result.current.spotifyCommand.action).not.toBe('play')
    expect(FakeAudio.instances.at(-1)?.src).toBe(
      `/api/v1/preview/audio?url=${encodeURIComponent(previewUrl)}`,
    )

    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', urls)
    })
    expect(outcome).toBe('paused')
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', urls)
    })
    expect(outcome).toBe('resumed')
    expect(result.current.state.playing).toBe(true)
  })

  it("returns 'no-source' and toasts when nothing resolves", async () => {
    const { result } = renderHook(() => usePreview(), { wrapper })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', null)
    })
    expect(outcome).toBe('no-source')
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('suppresses the no-source toast with suppressErrorToast', async () => {
    const { result } = renderHook(() => usePreview(), { wrapper })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', null, { suppressErrorToast: true })
    })
    expect(outcome).toBe('no-source')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("returns 'blocked' when autoplay is rejected, suppressing the toast on request", async () => {
    stubDeezerFetch()
    FakeAudio.playImpl = () =>
      Promise.reject(new DOMException('Playback denied', 'NotAllowedError'))
    const { result } = renderHook(() => usePreview(), { wrapper })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    expect(outcome).toBe('blocked')
    expect(toast.error).toHaveBeenCalledTimes(1)

    vi.mocked(toast.error).mockClear()
    await act(async () => {
      outcome = await result.current.play(
        'm2',
        'Portishead',
        { deezer: 'url' },
        { suppressErrorToast: true },
      )
    })
    expect(outcome).toBe('blocked')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('increments playbackEndedCount on ended and on error', async () => {
    stubDeezerFetch()
    const { result } = renderHook(() => usePreview(), { wrapper })

    await act(async () => {
      await result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    expect(result.current.playbackEndedCount).toBe(0)

    act(() => {
      FakeAudio.instances[0]?.onended?.()
    })
    expect(result.current.playbackEndedCount).toBe(1)
    expect(result.current.state.playing).toBe(false)

    act(() => {
      FakeAudio.instances[0]?.onerror?.()
    })
    expect(result.current.playbackEndedCount).toBe(2)
    expect(result.current.failureEvent).toMatchObject({
      artistMbid: 'm1',
      reason: 'playback-failed',
    })
  })

  it.each<
    [
      Record<string, string> | null,
      { data: Array<{ preview?: string; artist?: { name: string } }> } | undefined,
      string,
    ]
  >([
    [null, undefined, 'missing-links'],
    [{ deezer: 'https://deezer.com/artist/1' }, { data: [] }, 'no-match'],
    [
      { deezer: 'https://deezer.com/artist/1' },
      { data: [{ artist: { name: 'Artist' } }] },
      'no-audio',
    ],
    [{ deezer: 'https://deezer.com/artist/1' }, undefined, 'lookup-failed'],
  ])('reports coarse resolution failure %s', async (links, data, reason) => {
    if (data)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }))
    const { result } = renderHook(() => usePreview(), { wrapper })
    await act(async () => {
      await result.current.play('m1', 'Artist', links)
    })
    expect(result.current.failureEvent).toEqual({ sequence: 1, artistMbid: 'm1', reason })
    act(() => result.current.stop())
    expect(result.current.getLastFailure()).toMatchObject({ reason })
    act(() => result.current.clearFailure())
    expect(result.current.getLastFailure()).toBeNull()
  })

  it('does not mistake an error message for browser blocking, including on resume', async () => {
    stubDeezerFetch()
    const { result } = renderHook(() => usePreview(), { wrapper })
    await act(async () => {
      await result.current.play('m1', 'Artist', { deezer: 'url' })
    })
    await act(async () => {
      await result.current.play('m1', 'Artist', { deezer: 'url' })
    })
    FakeAudio.playImpl = () => Promise.reject(new Error('NotAllowedError'))
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Artist', { deezer: 'url' })
    })
    expect(outcome).toBe('failed')
    expect(result.current.getLastFailure()?.reason).toBe('playback-failed')
  })

  it('ignores old audio callbacks after another artist starts or stops', async () => {
    stubDeezerFetch()
    const { result } = renderHook(() => usePreview(), { wrapper })
    await act(async () => {
      await result.current.play('m1', 'First', { deezer: 'url' })
    })
    const old = FakeAudio.instances[0]
    await act(async () => {
      await result.current.play('m2', 'Second', { deezer: 'url' })
    })
    act(() => {
      old?.onerror?.()
      old?.onended?.()
    })
    expect(result.current.playbackEndedCount).toBe(0)
    expect(result.current.getLastFailure()).toBeNull()
    act(() => result.current.stop())
    act(() => FakeAudio.instances[1]?.onerror?.())
    expect(result.current.playbackEndedCount).toBe(0)
  })
})

describe('usePreview unmount', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    FakeAudio.playImpl = () => Promise.resolve()
    vi.stubGlobal('Audio', FakeAudio)
  })

  it('pauses playing audio on unmount', async () => {
    stubDeezerFetch()
    const { result, unmount } = renderHook(() => usePreview(), { wrapper })
    await act(async () => {
      await result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    const audio = FakeAudio.instances[0]
    if (!audio) throw new Error('audio was not created')
    const pause = vi.spyOn(audio, 'pause')
    unmount()
    expect(pause).toHaveBeenCalled()
  })

  it('does not start playback when a pending lookup resolves after unmount', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
      ),
    )
    const { result, unmount } = renderHook(() => usePreview(), { wrapper })
    let pending: Promise<string> | undefined
    act(() => {
      pending = result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    unmount()
    resolveFetch({
      ok: true,
      json: async () => ({
        data: [
          {
            preview: 'https://cdn.example/p.mp3',
            title: 'Creep',
            artist: { id: 1, name: 'Radiohead' },
          },
        ],
      }),
    })
    expect(await pending).toBe('superseded')
    expect(FakeAudio.instances).toHaveLength(0)
  })
})
