// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpotifyEmbed } from '@/web/hooks/use-spotify-embed'

class FakePort {
  messages: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  start = vi.fn()
  close = vi.fn()

  postMessage(message: unknown) {
    this.messages.push(message)
  }

  dispatch(message: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }
}

class FakeMessageChannel {
  static instances: FakeMessageChannel[] = []
  port1 = new FakePort()
  port2 = new FakePort()

  constructor() {
    FakeMessageChannel.instances.push(this)
  }
}

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

const callbacks = {
  onPlaybackStarted: vi.fn(),
  onPlaybackPaused: vi.fn(),
  onPlaybackEnded: vi.fn(),
}

function bridgeIframe(): HTMLIFrameElement {
  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[src="/spotify-embed-bridge.html"]',
  )
  if (!iframe) throw new Error('Spotify bridge iframe was not created')
  return iframe
}

function startBridge() {
  const iframe = bridgeIframe()
  const postMessage = vi
    .spyOn(iframe.contentWindow as Window, 'postMessage')
    .mockImplementation(() => undefined)
  fireEvent.load(iframe)
  const channel = FakeMessageChannel.instances.at(-1)
  if (!channel) throw new Error('Spotify bridge channel was not created')
  const init = postMessage.mock.calls[0]?.[0] as {
    type: string
    token: string
    url: string
  }
  return { iframe, postMessage, channel, token: init.token }
}

beforeEach(() => {
  FakeMessageChannel.instances = []
  callbacks.onPlaybackStarted.mockReset()
  callbacks.onPlaybackPaused.mockReset()
  callbacks.onPlaybackEnded.mockReset()
  vi.stubGlobal('MessageChannel', FakeMessageChannel)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSpotifyEmbed', () => {
  it('uses one sandboxed bridge and preserves playback state semantics', () => {
    const { rerender, unmount } = render(
      <Harness
        url="https://open.spotify.com/artist/first"
        keepAlive
        command={{ id: 1, action: 'play' }}
        {...callbacks}
      />,
    )

    const { iframe, postMessage, channel, token } = startBridge()
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(screen.getByTestId('spotify-host')).toContainElement(iframe)
    expect(
      document.querySelector('script[src^="https://open.spotify.com"]'),
    ).not.toBeInTheDocument()
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'spotify-bridge-init',
        token,
        url: 'https://open.spotify.com/artist/first',
      },
      '*',
      [channel.port2],
    )
    expect(channel.port1.start).toHaveBeenCalledTimes(1)

    act(() => channel.port1.dispatch({ type: 'ready', token: 'wrong-token' }))
    act(() => channel.port1.dispatch({ type: 'ready', token }))
    expect(channel.port1.messages).toEqual([{ type: 'play', token }])

    act(() =>
      channel.port1.dispatch({
        type: 'playback-state',
        token,
        paused: true,
        buffering: false,
        duration: 30_000,
        position: 30_000,
      }),
    )
    expect(callbacks.onPlaybackEnded).not.toHaveBeenCalled()

    act(() => channel.port1.dispatch({ type: 'playback-started', token }))
    expect(callbacks.onPlaybackStarted).toHaveBeenCalledTimes(1)

    act(() =>
      channel.port1.dispatch({
        type: 'playback-state',
        token,
        paused: true,
        buffering: false,
        duration: 30_000,
        position: 15_000,
      }),
    )
    expect(callbacks.onPlaybackPaused).toHaveBeenCalledTimes(1)

    act(() =>
      channel.port1.dispatch({
        type: 'playback-state',
        token,
        paused: false,
        buffering: false,
        duration: 30_000,
        position: 16_000,
      }),
    )
    expect(callbacks.onPlaybackStarted).toHaveBeenCalledTimes(2)

    const ended = {
      type: 'playback-state',
      token,
      paused: true,
      buffering: false,
      duration: 30_000,
      position: 30_000,
    }
    act(() => channel.port1.dispatch(ended))
    act(() => channel.port1.dispatch(ended))
    expect(callbacks.onPlaybackEnded).toHaveBeenCalledTimes(1)

    rerender(<Harness url={null} keepAlive command={{ id: 2, action: 'pause' }} {...callbacks} />)
    expect(channel.port1.messages.at(-1)).toEqual({ type: 'pause', token })
    expect(channel.port1.close).not.toHaveBeenCalled()

    rerender(
      <Harness
        url="https://open.spotify.com/artist/second"
        keepAlive
        command={{ id: 3, action: 'play' }}
        {...callbacks}
      />,
    )
    expect(channel.port1.messages.slice(-2)).toEqual([
      { type: 'load', token, url: 'https://open.spotify.com/artist/second' },
      { type: 'play', token },
    ])
    expect(FakeMessageChannel.instances).toHaveLength(1)

    unmount()
    expect(channel.port1.messages.at(-1)).toEqual({ type: 'destroy', token })
    expect(channel.port1.close).toHaveBeenCalledTimes(1)
  })

  it('reports bridge failure and clears it on a fresh attempt', async () => {
    const { rerender } = render(
      <Harness
        url="https://open.spotify.com/artist/first"
        keepAlive
        command={{ id: 1, action: 'play' }}
        {...callbacks}
      />,
    )
    const first = startBridge()

    act(() => first.channel.port1.dispatch({ type: 'failure', token: first.token }))
    await waitFor(() => expect(screen.getByTestId('spotify-failed')).toHaveTextContent('true'))
    expect(first.iframe).not.toBeInTheDocument()
    expect(first.channel.port1.close).toHaveBeenCalledTimes(1)

    rerender(
      <Harness
        url="https://open.spotify.com/artist/first"
        keepAlive
        command={{ id: 2, action: 'play' }}
        {...callbacks}
      />,
    )
    const second = startBridge()
    expect(screen.getByTestId('spotify-failed')).toHaveTextContent('false')

    act(() => second.channel.port1.dispatch({ type: 'ready', token: second.token }))
    expect(second.channel.port1.messages).toContainEqual({ type: 'play', token: second.token })
  })

  it('fails when the bridge loads but never becomes ready', () => {
    vi.useFakeTimers()
    render(
      <Harness
        url="https://open.spotify.com/artist/third"
        keepAlive
        command={{ id: 1, action: 'play' }}
        {...callbacks}
      />,
    )
    const { iframe, channel } = startBridge()

    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByTestId('spotify-failed')).toHaveTextContent('true')
    expect(iframe).not.toBeInTheDocument()
    expect(channel.port1.close).toHaveBeenCalledTimes(1)
  })

  it('removes the bridge when posting the destroy command fails', () => {
    const { unmount } = render(
      <Harness
        url="https://open.spotify.com/artist/first"
        keepAlive
        command={{ id: 1, action: 'play' }}
        {...callbacks}
      />,
    )
    const { iframe, channel } = startBridge()
    channel.port1.postMessage = vi.fn(() => {
      throw new Error('closed port')
    })

    expect(() => unmount()).not.toThrow()
    expect(iframe).not.toBeInTheDocument()
    expect(channel.port1.close).toHaveBeenCalledTimes(1)
  })
})
