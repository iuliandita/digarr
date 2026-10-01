// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AuditionItem,
  EMBED_ADVANCE_MS,
  useAuditionQueue,
} from '@/web/hooks/use-audition-queue'
import type {
  PlayOutcome,
  PreviewFailure,
  PreviewSource,
  usePreview,
} from '@/web/hooks/use-preview'

type Preview = ReturnType<typeof usePreview>

type PreviewState = Preview['state']

const IDLE_STATE: PreviewState = {
  playing: false,
  artistMbid: null,
  artistName: null,
  source: null,
  loading: false,
  error: null,
}

const spotifySource: PreviewSource = {
  type: 'spotify-embed',
  url: 'https://open.spotify.com/artist/abc',
  embedUrl: 'https://open.spotify.com/embed/artist/abc',
}

const deezerSource: PreviewSource = {
  type: 'deezer-audio',
  url: 'https://cdn.example/p.mp3',
  embedUrl: 'https://cdn.example/p.mp3',
}

const youtubeSource: PreviewSource = {
  type: 'youtube-embed',
  url: 'https://youtube.com/watch?v=abc',
  embedUrl: 'https://youtube.com/embed/abc?autoplay=1',
}

type PlayScript = { outcome: PlayOutcome; source?: PreviewSource }

// Fake single-item engine: play() mutates state the way usePreview does so the
// queue's effects observe a consistent engine after each transition.
function createFakePreview(scripts: Record<string, PlayScript> = {}) {
  const fake = {
    state: { ...IDLE_STATE },
    play: vi.fn(
      async (
        mbid: string,
        artistName: string,
        _streamingUrls: Record<string, string> | null,
        _opts?: { suppressErrorToast?: boolean },
      ): Promise<PlayOutcome> => {
        const script = scripts[mbid] ?? { outcome: 'started', source: spotifySource }
        if (script.outcome === 'started') {
          fake.state = {
            playing: true,
            artistMbid: mbid,
            artistName,
            source: script.source ?? spotifySource,
            loading: false,
            error: null,
          }
        } else {
          fake.state = { ...IDLE_STATE }
        }
        return script.outcome
      },
    ),
    stop: vi.fn(() => {
      fake.state = { ...IDLE_STATE }
    }),
    hasPreview: vi.fn(() => true),
    globalPlayId: 0,
    playbackEndedCount: 0,
    failureEvent: null,
    getLastFailure: vi.fn<() => PreviewFailure | null>(() => null),
    clearFailure: vi.fn(),
    volume: 1,
    setVolume: vi.fn(),
  }
  return fake
}

type FakePreview = ReturnType<typeof createFakePreview>

function renderQueue(fake: FakePreview) {
  return renderHook(({ preview }) => useAuditionQueue(preview as unknown as Preview), {
    initialProps: { preview: fake },
  })
}

const items: AuditionItem[] = [
  { mbid: 'a', artistName: 'Artist A', streamingUrls: { spotify: 'sa' } },
  { mbid: 'b', artistName: 'Artist B', streamingUrls: { spotify: 'sb' } },
  { mbid: 'c', artistName: 'Artist C', streamingUrls: { spotify: 'sc' } },
]

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAuditionQueue', () => {
  it('retains every unavailable item after the queue ends and can dismiss the summary', async () => {
    const fake = createFakePreview({
      a: { outcome: 'no-source' },
      b: { outcome: 'blocked' },
      c: { outcome: 'failed' },
    })
    const { result } = renderQueue(fake)
    await act(async () => result.current.start(items))
    expect(result.current.active).toBe(false)
    expect(result.current.selectedCount).toBe(3)
    expect(result.current.unavailable.map((entry) => entry.item.mbid)).toEqual(['a', 'b', 'c'])
    await act(async () => result.current.dismissSummary())
    expect(result.current.unavailable).toEqual([])
  })

  it('replaces a failed item on retry and resets the summary on a new run', async () => {
    const scripts: Record<string, PlayScript> = { a: { outcome: 'failed' } }
    const fake = createFakePreview(scripts)
    fake.getLastFailure.mockReturnValue({ sequence: 1, artistMbid: 'a', reason: 'lookup-failed' })
    const { result } = renderQueue(fake)
    await act(async () => result.current.start(items))
    expect(result.current.unavailable[0]?.reason).toBe('lookup-failed')
    scripts.a = { outcome: 'started' }
    await act(async () => result.current.previous())
    expect(result.current.unavailable).toEqual([])
    await act(async () => result.current.start(items.slice(2)))
    expect(result.current.selectedCount).toBe(1)
    expect(result.current.unavailable).toEqual([])
  })

  it('records an asynchronous playback failure before advancing', async () => {
    const fake = createFakePreview()
    const { result, rerender } = renderQueue(fake)
    await act(async () => result.current.start(items))
    fake.getLastFailure.mockReturnValue({
      sequence: 1,
      artistMbid: 'a',
      reason: 'controller-unavailable',
    })
    fake.playbackEndedCount += 1
    await act(async () => rerender({ preview: fake }))
    expect(result.current.current?.mbid).toBe('b')
    expect(result.current.unavailable.map((entry) => entry.reason)).toEqual([
      'controller-unavailable',
    ])
  })

  it('ignores an older lookup after navigating away and back to the same item', async () => {
    const fake = createFakePreview()
    let resolveFirst: (outcome: PlayOutcome) => void = () => {}
    let resolveLatest: (outcome: PlayOutcome) => void = () => {}
    const original = fake.play.getMockImplementation()
    fake.play.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    const { result } = renderQueue(fake)
    await act(async () => result.current.start(items))
    await act(async () => result.current.next())
    fake.play.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLatest = resolve
        }),
    )
    await act(async () => result.current.previous())
    await act(async () => resolveFirst('superseded'))
    expect(result.current.active).toBe(true)
    expect(result.current.current?.mbid).toBe('a')
    expect(result.current.unavailable).toEqual([])
    fake.play.mockImplementation(original ?? (() => Promise.resolve('started')))
    await act(async () => resolveLatest('started'))
    expect(result.current.active).toBe(true)
  })

  it('does not label a superseded request unavailable', async () => {
    const fake = createFakePreview({ a: { outcome: 'superseded' } })
    const { result } = renderQueue(fake)
    await act(async () => result.current.start(items))
    expect(result.current.active).toBe(false)
    expect(result.current.unavailable).toEqual([])
  })

  it('start() stops the engine first, then plays item 0 with suppressed toasts', async () => {
    const fake = createFakePreview()
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })

    expect(fake.stop).toHaveBeenCalledTimes(1)
    expect(fake.play).toHaveBeenCalledTimes(1)
    expect(fake.play).toHaveBeenCalledWith(
      'a',
      'Artist A',
      { spotify: 'sa' },
      {
        suppressErrorToast: true,
      },
    )
    expect(fake.stop.mock.invocationCallOrder[0]).toBeLessThan(
      fake.play.mock.invocationCallOrder[0] as number,
    )
    expect(result.current.active).toBe(true)
    expect(result.current.index).toBe(0)
    expect(result.current.count).toBe(3)
    expect(result.current.current?.mbid).toBe('a')
  })

  it('start() with an empty list is a no-op', async () => {
    const fake = createFakePreview()
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start([])
    })

    expect(result.current.active).toBe(false)
    expect(fake.play).not.toHaveBeenCalled()
    expect(fake.stop).not.toHaveBeenCalled()
  })

  it('advances when playbackEndedCount bumps (deezer ended)', async () => {
    const fake = createFakePreview({ a: { outcome: 'started', source: deezerSource } })
    const { result, rerender } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })

    fake.playbackEndedCount = 1
    await act(async () => {
      rerender({ preview: fake })
    })

    expect(fake.play).toHaveBeenCalledTimes(2)
    expect(fake.play).toHaveBeenLastCalledWith(
      'b',
      'Artist B',
      { spotify: 'sb' },
      {
        suppressErrorToast: true,
      },
    )
    expect(result.current.index).toBe(1)
  })

  it('arms the YouTube timer and advances after EMBED_ADVANCE_MS', async () => {
    const fake = createFakePreview({ a: { outcome: 'started', source: youtubeSource } })
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })
    expect(result.current.index).toBe(0)

    await act(async () => {
      vi.advanceTimersByTime(EMBED_ADVANCE_MS - 1)
    })
    expect(result.current.index).toBe(0)

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.index).toBe(1)
    expect(fake.play).toHaveBeenLastCalledWith(
      'b',
      'Artist B',
      { spotify: 'sb' },
      {
        suppressErrorToast: true,
      },
    )
  })

  it('does not advance a Spotify entry before real playback completion', async () => {
    const fake = createFakePreview()
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })
    await act(async () => {
      vi.advanceTimersByTime(EMBED_ADVANCE_MS * 2)
    })

    expect(result.current.index).toBe(0)
    expect(fake.play).toHaveBeenCalledTimes(1)
  })

  it('does not arm the timer for deezer sources', async () => {
    const fake = createFakePreview({ a: { outcome: 'started', source: deezerSource } })
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })
    await act(async () => {
      vi.advanceTimersByTime(EMBED_ADVANCE_MS * 2)
    })

    expect(result.current.index).toBe(0)
    expect(fake.play).toHaveBeenCalledTimes(1)
  })

  it('manual next() clears the pending embed timer', async () => {
    const fake = createFakePreview({ b: { outcome: 'started', source: deezerSource } })
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })
    await act(async () => {
      result.current.next()
    })
    expect(result.current.index).toBe(1)

    // Item b is deezer (no new timer); the old timer for item a must be gone.
    await act(async () => {
      vi.advanceTimersByTime(EMBED_ADVANCE_MS)
    })
    expect(result.current.index).toBe(1)
    expect(fake.play).toHaveBeenCalledTimes(2)
  })

  it("skips immediately on 'no-source' and 'blocked' outcomes", async () => {
    const fake = createFakePreview({
      a: { outcome: 'no-source' },
      b: { outcome: 'blocked' },
    })
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })

    expect(fake.play).toHaveBeenCalledTimes(3)
    expect(result.current.active).toBe(true)
    expect(result.current.index).toBe(2)
    expect(result.current.current?.mbid).toBe('c')
  })

  it('deactivates without preview.stop() when every item fails', async () => {
    const fake = createFakePreview({
      a: { outcome: 'no-source' },
      b: { outcome: 'no-source' },
      c: { outcome: 'no-source' },
    })
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })

    expect(result.current.active).toBe(false)
    // Only the initial stop from start(); no redundant stop when nothing plays.
    expect(fake.stop).toHaveBeenCalledTimes(1)
  })

  it('ended signal past the last item deactivates and stops the engine', async () => {
    const fake = createFakePreview({ a: { outcome: 'started', source: deezerSource } })
    const { result, rerender } = renderQueue(fake)

    await act(async () => {
      result.current.start([items[0] as AuditionItem])
    })

    fake.playbackEndedCount = 1
    await act(async () => {
      rerender({ preview: fake })
    })

    expect(result.current.active).toBe(false)
    expect(fake.stop).toHaveBeenCalledTimes(2)
  })

  it('next() at the last item ends the queue like stop()', async () => {
    const fake = createFakePreview()
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start([items[0] as AuditionItem])
    })
    await act(async () => {
      result.current.next()
    })

    expect(result.current.active).toBe(false)
    expect(fake.stop).toHaveBeenCalledTimes(2)
  })

  it('previous() is a no-op at index 0 and steps back otherwise', async () => {
    const fake = createFakePreview()
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })
    await act(async () => {
      result.current.previous()
    })
    expect(result.current.index).toBe(0)
    expect(fake.play).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.next()
    })
    expect(result.current.index).toBe(1)

    await act(async () => {
      result.current.previous()
    })
    expect(result.current.index).toBe(0)
    expect(fake.play).toHaveBeenLastCalledWith(
      'a',
      'Artist A',
      { spotify: 'sa' },
      {
        suppressErrorToast: true,
      },
    )
  })

  it('stop() clears the queue and stops the engine', async () => {
    const fake = createFakePreview()
    const { result } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })
    await act(async () => {
      result.current.stop()
    })

    expect(result.current.active).toBe(false)
    expect(result.current.count).toBe(0)
    expect(result.current.current).toBeNull()
    expect(fake.stop).toHaveBeenCalledTimes(2)
  })

  it('deactivates without stopping when another surface plays a different artist', async () => {
    const fake = createFakePreview()
    const { result, rerender } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })
    expect(result.current.active).toBe(true)

    // A card play changed the engine out from under the queue.
    fake.state = {
      playing: true,
      artistMbid: 'external',
      artistName: 'Someone Else',
      source: spotifySource,
      loading: false,
      error: null,
    }
    await act(async () => {
      rerender({ preview: fake })
    })

    expect(result.current.active).toBe(false)
    expect(fake.stop).toHaveBeenCalledTimes(1)
    expect(fake.play).toHaveBeenCalledTimes(1)
  })

  it('deactivates without stopping on an external stop (idle engine)', async () => {
    const fake = createFakePreview()
    const { result, rerender } = renderQueue(fake)

    await act(async () => {
      result.current.start(items)
    })

    // e.g. TopTracks called preview.stop() before playing its local audio.
    fake.state = { ...IDLE_STATE }
    await act(async () => {
      rerender({ preview: fake })
    })

    expect(result.current.active).toBe(false)
    expect(fake.stop).toHaveBeenCalledTimes(1)
  })
})
