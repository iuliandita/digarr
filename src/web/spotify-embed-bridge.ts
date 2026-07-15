import {
  isSpotifyBridgeCommand,
  isSpotifyBridgeEvent,
  isSpotifyBridgeInit,
  type SpotifyBridgeEvent,
} from './lib/spotify-bridge-protocol'

const SPOTIFY_IFRAME_API_SRC = 'https://open.spotify.com/embed/iframe-api/v1'
const SPOTIFY_API_TIMEOUT_MS = 10_000

type SpotifyPlaybackEvent = {
  data?: {
    isPaused?: unknown
    isBuffering?: unknown
    duration?: unknown
    position?: unknown
  }
}

type SpotifyEmbedController = {
  addListener: (event: string, listener: (event: SpotifyPlaybackEvent) => void) => void
  loadEntity: (url: string) => void
  play: () => void
  pause: () => void
  destroy: () => void
}

type SpotifyIframeApi = {
  createController: (
    element: HTMLElement,
    options: { url: string; width: string; height: number },
    callback: (controller: SpotifyEmbedController) => void,
  ) => void
}

type SpotifyWindow = Window & {
  onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void
}

function referrerOrigin(): string | null {
  if (!document.referrer) return null
  try {
    return new URL(document.referrer).origin
  } catch {
    return null
  }
}

function nonnegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

const expectedParentOrigin = referrerOrigin()
const host = document.querySelector<HTMLElement>('#spotify-embed-host')
const spotifyWindow = window as SpotifyWindow

let port: MessagePort | null = null
let token: string | null = null
let script: HTMLScriptElement | null = null
let controller: SpotifyEmbedController | null = null
let timeout: ReturnType<typeof setTimeout> | null = null
let closed = false

function clearBridgeTimeout() {
  if (timeout) clearTimeout(timeout)
  timeout = null
}

function send(event: SpotifyBridgeEvent) {
  if (!port || !isSpotifyBridgeEvent(event)) return
  try {
    port.postMessage(event)
  } catch {
    closeBridge()
  }
}

function clearReadyCallback() {
  delete spotifyWindow.onSpotifyIframeApiReady
}

function closeBridge() {
  if (closed) return
  closed = true
  clearBridgeTimeout()
  clearReadyCallback()
  try {
    controller?.destroy()
  } catch {
    // The remote adapter must not block local cleanup.
  }
  controller = null
  script?.remove()
  script = null
  host?.replaceChildren()
  try {
    port?.close()
  } catch {
    // The document and controller are already detached.
  }
  port = null
}

function failBridge() {
  if (closed || !token) return
  send({ type: 'failure', token })
  closeBridge()
}

function applyCommand(event: MessageEvent<unknown>) {
  if (!token || !isSpotifyBridgeCommand(event.data) || event.data.token !== token) return

  if (event.data.type === 'destroy') {
    closeBridge()
    return
  }
  if (!controller) return

  try {
    if (event.data.type === 'load') controller.loadEntity(event.data.url)
    else controller[event.data.type]()
  } catch {
    failBridge()
  }
}

function attachController(nextController: SpotifyEmbedController) {
  if (!token || closed) {
    nextController.destroy()
    return
  }

  clearBridgeTimeout()
  controller = nextController
  try {
    nextController.addListener('ready', () => {
      if (token && !closed) send({ type: 'ready', token })
    })
    nextController.addListener('playback_started', () => {
      if (token && !closed) send({ type: 'playback-started', token })
    })
    nextController.addListener('playback_update', (event) => {
      if (!token || closed) return
      send({
        type: 'playback-state',
        token,
        paused: event.data?.isPaused === true,
        buffering: event.data?.isBuffering === true,
        duration: nonnegativeNumber(event.data?.duration),
        position: nonnegativeNumber(event.data?.position),
      })
    })
    nextController.addListener('playback_error', failBridge)
  } catch {
    failBridge()
  }
}

function loadSpotifyController(url: string) {
  if (!host) {
    failBridge()
    return
  }

  script = document.createElement('script')
  script.src = SPOTIFY_IFRAME_API_SRC
  script.async = true
  script.addEventListener('error', failBridge, { once: true })
  spotifyWindow.onSpotifyIframeApiReady = (api) => {
    if (closed) return
    clearReadyCallback()
    clearBridgeTimeout()
    timeout = setTimeout(failBridge, SPOTIFY_API_TIMEOUT_MS)
    try {
      api.createController(host, { url, width: '100%', height: 80 }, attachController)
    } catch {
      failBridge()
    }
  }
  timeout = setTimeout(failBridge, SPOTIFY_API_TIMEOUT_MS)
  document.body.append(script)
}

function acceptInit(event: MessageEvent<unknown>) {
  if (
    port ||
    !expectedParentOrigin ||
    event.source !== window.parent ||
    event.origin !== expectedParentOrigin ||
    event.ports.length !== 1 ||
    !isSpotifyBridgeInit(event.data)
  ) {
    return
  }

  window.removeEventListener('message', acceptInit)
  token = event.data.token
  port = event.ports[0] ?? null
  if (!port) return
  try {
    port.onmessage = applyCommand
    port.onmessageerror = failBridge
    port.start()
    loadSpotifyController(event.data.url)
  } catch {
    failBridge()
  }
}

window.addEventListener('message', acceptInit)
