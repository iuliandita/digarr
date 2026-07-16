// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const token = 'test'
const url = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'
const parentOrigin = 'https://app.example'
const spotifyWindow = window as Window & {
  onSpotifyIframeApiReady?: (api: never) => void
}

class FakePort {
  messages: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  start = vi.fn()
  close = vi.fn()

  postMessage(message: unknown) {
    this.messages.push(message)
  }

  dispatch(message: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }
}

function dispatchInit(
  port: FakePort,
  overrides: {
    origin?: string
    source?: MessageEventSource | null
    ports?: MessagePort[]
  } = {},
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'spotify-bridge-init', token, url },
      origin: overrides.origin ?? parentOrigin,
      source: overrides.source === undefined ? window.parent : overrides.source,
      ports: overrides.ports ?? ([port] as unknown as MessagePort[]),
    }),
  )
}

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = '<div id="spotify-embed-host"></div>'
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    value: `${parentOrigin}/discover`,
  })
})

afterEach(() => {
  vi.useRealTimers()
  document.querySelector('script[src="https://open.spotify.com/embed/iframe-api/v1"]')?.remove()
  delete spotifyWindow.onSpotifyIframeApiReady
})

describe('Spotify embed bridge', () => {
  it('has a minimal standalone document', () => {
    const html = readFileSync('spotify-embed-bridge.html', 'utf8')

    expect(html).toContain('id="spotify-embed-host"')
    expect(html).toContain('src="/src/web/spotify-embed-bridge.ts"')
    expect(html).not.toContain('/src/web/main.tsx')
  })

  it('accepts one parent handshake and translates controller traffic', async () => {
    await import('@/web/spotify-embed-bridge')
    const port = new FakePort()

    dispatchInit(port, { source: null })
    dispatchInit(port, { origin: 'https://evil.example' })
    dispatchInit(port, { ports: [] })
    expect(document.querySelector('script')).not.toBeInTheDocument()

    dispatchInit(port)
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://open.spotify.com/embed/iframe-api/v1"]',
    )
    expect(script).toBeInTheDocument()
    expect(port.start).toHaveBeenCalledTimes(1)

    const secondPort = new FakePort()
    dispatchInit(secondPort)
    expect(secondPort.start).not.toHaveBeenCalled()

    const listeners = new Map<string, (event: { data?: Record<string, unknown> }) => void>()
    const controller = {
      addListener: vi.fn(
        (name: string, listener: (event: { data?: Record<string, unknown> }) => void) => {
          listeners.set(name, listener)
        },
      ),
      loadEntity: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(() => {
        throw new Error('remote destroy failed')
      }),
    }
    const iframeApi = {
      createController: vi.fn(
        (
          _host: HTMLElement,
          _options: Record<string, unknown>,
          callback: (value: typeof controller) => void,
        ) => callback(controller),
      ),
    }

    spotifyWindow.onSpotifyIframeApiReady?.(iframeApi as never)
    expect(iframeApi.createController).toHaveBeenCalledWith(
      document.querySelector('#spotify-embed-host'),
      { url, width: '100%', height: 80 },
      expect.any(Function),
    )

    listeners.get('ready')?.({})
    listeners.get('playback_started')?.({})
    listeners.get('playback_update')?.({
      data: {
        isPaused: false,
        isBuffering: true,
        duration: 30_000,
        position: 5_000,
      },
    })
    expect(port.messages).toEqual([
      { type: 'ready', token },
      { type: 'playback-started', token },
      {
        type: 'playback-state',
        token,
        paused: false,
        buffering: true,
        duration: 30_000,
        position: 5_000,
      },
    ])

    port.dispatch({ type: 'play', token: 'wrong-token' })
    port.dispatch({ type: 'load', token, url: 'https://evil.example/track/abc' })
    expect(controller.play).not.toHaveBeenCalled()
    expect(controller.loadEntity).not.toHaveBeenCalled()

    port.dispatch({ type: 'load', token, url: 'https://open.spotify.com/track/second' })
    port.dispatch({ type: 'play', token })
    port.dispatch({ type: 'pause', token })
    expect(controller.loadEntity).toHaveBeenCalledWith('https://open.spotify.com/track/second')
    expect(controller.play).toHaveBeenCalledTimes(1)
    expect(controller.pause).toHaveBeenCalledTimes(1)

    port.dispatch({ type: 'destroy', token })
    expect(controller.destroy).toHaveBeenCalledTimes(1)
    expect(script).not.toBeInTheDocument()
    expect(port.close).toHaveBeenCalledTimes(1)
  })

  it('reports script failure and removes bridge resources', async () => {
    await import('@/web/spotify-embed-bridge')
    const port = new FakePort()
    dispatchInit(port)

    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://open.spotify.com/embed/iframe-api/v1"]',
    )
    script?.dispatchEvent(new Event('error'))

    expect(port.messages).toEqual([{ type: 'failure', token }])
    expect(script).not.toBeInTheDocument()
    expect(port.close).toHaveBeenCalledTimes(1)
  })
})
