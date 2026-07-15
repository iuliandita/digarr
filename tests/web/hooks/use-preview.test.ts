// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePreviewSource, usePreview } from '@/web/hooks/use-preview'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

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
    expect(result?.embedUrl).toContain('autoplay=1')
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
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ preview: 'https://cdn.example/p.mp3' }] }),
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
  })

  it("returns 'started', then 'paused', then 'resumed' for the same deezer artist", async () => {
    stubDeezerFetch()
    const { result } = renderHook(() => usePreview(), { wrapper })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', {})
    })
    expect(outcome).toBe('started')

    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', {})
    })
    expect(outcome).toBe('paused')
    expect(result.current.state.playing).toBe(false)

    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', {})
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
    FakeAudio.playImpl = () => Promise.reject(new Error('NotAllowedError'))
    const { result } = renderHook(() => usePreview(), { wrapper })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.play('m1', 'Radiohead', {})
    })
    expect(outcome).toBe('blocked')
    expect(toast.error).toHaveBeenCalledTimes(1)

    vi.mocked(toast.error).mockClear()
    await act(async () => {
      outcome = await result.current.play('m2', 'Portishead', {}, { suppressErrorToast: true })
    })
    expect(outcome).toBe('blocked')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('increments playbackEndedCount on ended and on error', async () => {
    stubDeezerFetch()
    const { result } = renderHook(() => usePreview(), { wrapper })

    await act(async () => {
      await result.current.play('m1', 'Radiohead', {})
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
  })
})
