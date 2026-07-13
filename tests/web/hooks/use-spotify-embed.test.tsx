// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSpotifyEmbed } from '@/web/hooks/use-spotify-embed'

type SpotifyEvent = { data: Record<string, unknown> }
type SpotifyListener = (event: SpotifyEvent) => void

function Harness({
  url,
  keepAlive,
  command,
  onPlaybackStarted,
  onPlaybackPaused,
  onPlaybackEnded,
}: {
  url: string | null
  keepAlive: boolean
  command: { id: number; action: 'play' | 'pause' }
  onPlaybackStarted: () => void
  onPlaybackPaused: () => void
  onPlaybackEnded: () => void
}) {
  const { hostRef, failed } = useSpotifyEmbed({
    url,
    keepAlive,
    command,
    onPlaybackStarted,
    onPlaybackPaused,
    onPlaybackEnded,
  }) as { hostRef: RefObject<HTMLDivElement>; failed: boolean }

  return (
    <>
      <div ref={hostRef} data-testid="spotify-host" />
      <output data-testid="spotify-failed">{String(failed)}</output>
    </>
  )
}

afterEach(() => {
  vi.useRealTimers()
  document.querySelector('script[src="https://open.spotify.com/embed/iframe-api/v1"]')?.remove()
  delete window.onSpotifyIframeApiReady
})

describe('useSpotifyEmbed', () => {
  it('recovers initialization, preserves React ownership, and reports playback state', async () => {
    const listeners = new Map<string, SpotifyListener>()
    let iframe: HTMLIFrameElement | null = null
    const controller = {
      addListener: vi.fn((event: string, listener: SpotifyListener) => {
        listeners.set(event, listener)
      }),
      loadEntity: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(() => iframe?.remove()),
    }
    const iframeApi = {
      createController: vi.fn(
        (
          element: HTMLElement,
          _options: Record<string, unknown>,
          callback: (created: typeof controller) => void,
        ) => {
          iframe = document.createElement('iframe')
          element.replaceWith(iframe)
          callback(controller)
        },
      ),
    }
    const onPlaybackStarted = vi.fn()
    const onPlaybackPaused = vi.fn()
    const onPlaybackEnded = vi.fn()

    const { rerender, unmount } = render(
      <Harness
        url="https://open.spotify.com/artist/first"
        keepAlive
        command={{ id: 1, action: 'play' }}
        onPlaybackStarted={onPlaybackStarted}
        onPlaybackPaused={onPlaybackPaused}
        onPlaybackEnded={onPlaybackEnded}
      />,
    )

    expect(
      document.querySelector('script[src="https://open.spotify.com/embed/iframe-api/v1"]'),
    ).toBeInTheDocument()

    const firstScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://open.spotify.com/embed/iframe-api/v1"]',
    )
    act(() => firstScript?.dispatchEvent(new Event('error')))
    await waitFor(() => expect(screen.getByTestId('spotify-failed')).toHaveTextContent('true'))
    expect(firstScript).not.toBeInTheDocument()

    rerender(
      <Harness
        url="https://open.spotify.com/artist/first"
        keepAlive
        command={{ id: 2, action: 'play' }}
        onPlaybackStarted={onPlaybackStarted}
        onPlaybackPaused={onPlaybackPaused}
        onPlaybackEnded={onPlaybackEnded}
      />,
    )
    expect(
      document.querySelector('script[src="https://open.spotify.com/embed/iframe-api/v1"]'),
    ).toBeInTheDocument()

    rerender(
      <Harness
        url={null}
        keepAlive
        command={{ id: 3, action: 'pause' }}
        onPlaybackStarted={onPlaybackStarted}
        onPlaybackPaused={onPlaybackPaused}
        onPlaybackEnded={onPlaybackEnded}
      />,
    )
    await act(async () => {
      window.onSpotifyIframeApiReady?.(iframeApi)
      await Promise.resolve()
    })
    expect(iframeApi.createController).not.toHaveBeenCalled()

    rerender(
      <Harness
        url="https://open.spotify.com/artist/first"
        keepAlive
        command={{ id: 4, action: 'play' }}
        onPlaybackStarted={onPlaybackStarted}
        onPlaybackPaused={onPlaybackPaused}
        onPlaybackEnded={onPlaybackEnded}
      />,
    )

    await waitFor(() => expect(iframeApi.createController).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('spotify-failed')).toHaveTextContent('false')
    expect(iframeApi.createController.mock.calls[0]?.[1]).toMatchObject({
      url: 'https://open.spotify.com/artist/first',
      width: '100%',
      height: 80,
    })
    expect(controller.play).not.toHaveBeenCalled()
    expect(screen.getByTestId('spotify-host')).toContainElement(iframe)

    listeners.get('ready')?.({ data: {} })
    expect(controller.play).toHaveBeenCalledTimes(1)

    listeners.get('playback_update')?.({
      data: { isPaused: true, duration: 30_000, position: 30_000 },
    })
    expect(onPlaybackEnded).not.toHaveBeenCalled()

    listeners.get('playback_started')?.({ data: { playingURI: 'spotify:track:first' } })
    expect(onPlaybackStarted).toHaveBeenCalledTimes(1)

    listeners.get('playback_update')?.({
      data: { isPaused: true, isBuffering: false, duration: 30_000, position: 15_000 },
    })
    expect(onPlaybackPaused).toHaveBeenCalledTimes(1)

    listeners.get('playback_update')?.({
      data: { isPaused: false, isBuffering: false, duration: 30_000, position: 16_000 },
    })
    expect(onPlaybackStarted).toHaveBeenCalledTimes(2)

    listeners.get('playback_update')?.({
      data: { isPaused: true, duration: 30_000, position: 30_000 },
    })
    listeners.get('playback_update')?.({
      data: { isPaused: true, duration: 30_000, position: 30_000 },
    })
    expect(onPlaybackEnded).toHaveBeenCalledTimes(1)

    rerender(
      <Harness
        url={null}
        keepAlive
        command={{ id: 2, action: 'pause' }}
        onPlaybackStarted={onPlaybackStarted}
        onPlaybackPaused={onPlaybackPaused}
        onPlaybackEnded={onPlaybackEnded}
      />,
    )
    expect(controller.pause).toHaveBeenCalledTimes(1)
    expect(controller.destroy).not.toHaveBeenCalled()

    rerender(
      <Harness
        url="https://open.spotify.com/artist/second"
        keepAlive
        command={{ id: 3, action: 'play' }}
        onPlaybackStarted={onPlaybackStarted}
        onPlaybackPaused={onPlaybackPaused}
        onPlaybackEnded={onPlaybackEnded}
      />,
    )
    expect(controller.loadEntity).toHaveBeenCalledWith('https://open.spotify.com/artist/second')
    expect(controller.play).toHaveBeenCalledTimes(2)
    expect(iframeApi.createController).toHaveBeenCalledTimes(1)

    unmount()
    expect(controller.destroy).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    iframeApi.createController.mockImplementationOnce((element: HTMLElement) => {
      iframe = document.createElement('iframe')
      element.replaceWith(iframe)
    })
    const timedOut = render(
      <Harness
        url="https://open.spotify.com/artist/third"
        keepAlive
        command={{ id: 6, action: 'play' }}
        onPlaybackStarted={onPlaybackStarted}
        onPlaybackPaused={onPlaybackPaused}
        onPlaybackEnded={onPlaybackEnded}
      />,
    )
    await act(async () => Promise.resolve())
    expect(iframeApi.createController).toHaveBeenCalledTimes(2)

    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByTestId('spotify-failed')).toHaveTextContent('true')
    timedOut.unmount()
  })
})
