import { useCallback, useEffect, useRef, useState } from 'react'
import { isSpotifyBridgeEvent, type SpotifyBridgeCommand } from '@/web/lib/spotify-bridge-protocol'

const SPOTIFY_BRIDGE_SRC = '/spotify-embed-bridge.html'
const SPOTIFY_BRIDGE_TIMEOUT_MS = 10_000

function createBridgeToken(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

export type SpotifyPlaybackCommand = {
  id: number
  action: 'play' | 'pause'
}

type SpotifyBridgeController = {
  token: string
  post: (command: SpotifyBridgeCommand) => void
  destroy: () => void
}

type UseSpotifyEmbedOptions = {
  url: string | null
  keepAlive: boolean
  command: SpotifyPlaybackCommand
  onPlaybackStarted: () => void
  onPlaybackPaused: () => void
  onPlaybackEnded: () => void
}

export function useSpotifyEmbed({
  url,
  keepAlive,
  command,
  onPlaybackStarted,
  onPlaybackPaused,
  onPlaybackEnded,
}: UseSpotifyEmbedOptions) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<SpotifyBridgeController | null>(null)
  const creatingRef = useRef(false)
  const attemptRef = useRef(0)
  const createTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyRef = useRef(false)
  const loadedUrlRef = useRef<string | null>(null)
  const startedRef = useRef(false)
  const pausedRef = useRef(false)
  const endedRef = useRef(false)
  const disposedRef = useRef(false)
  const latestRef = useRef({ url, keepAlive, command })
  const onPlaybackStartedRef = useRef(onPlaybackStarted)
  const onPlaybackPausedRef = useRef(onPlaybackPaused)
  const onPlaybackEndedRef = useRef(onPlaybackEnded)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  latestRef.current = { url, keepAlive, command }
  onPlaybackStartedRef.current = onPlaybackStarted
  onPlaybackPausedRef.current = onPlaybackPaused
  onPlaybackEndedRef.current = onPlaybackEnded

  const clearControllerTimeouts = useCallback(() => {
    if (createTimeoutRef.current) clearTimeout(createTimeoutRef.current)
    if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current)
    createTimeoutRef.current = null
    readyTimeoutRef.current = null
  }, [])

  const resetPlaybackState = useCallback(() => {
    readyRef.current = false
    loadedUrlRef.current = null
    startedRef.current = false
    pausedRef.current = false
    endedRef.current = false
  }, [])

  const removeController = useCallback(() => {
    clearControllerTimeouts()
    controllerRef.current?.destroy()
    controllerRef.current = null
    hostRef.current?.replaceChildren()
    resetPlaybackState()
  }, [clearControllerTimeouts, resetPlaybackState])

  const destroyController = useCallback(() => {
    attemptRef.current += 1
    creatingRef.current = false
    removeController()
  }, [removeController])

  const failAttempt = useCallback(
    (attempt: number) => {
      if (attemptRef.current !== attempt || disposedRef.current) return
      attemptRef.current += 1
      creatingRef.current = false
      removeController()
      setFailedUrl(latestRef.current.url)
    },
    [removeController],
  )

  const loadUrl = useCallback((controller: SpotifyBridgeController, nextUrl: string) => {
    if (loadedUrlRef.current === nextUrl) return
    controller.post({ type: 'load', token: controller.token, url: nextUrl })
    loadedUrlRef.current = nextUrl
    startedRef.current = false
    pausedRef.current = false
    endedRef.current = false
  }, [])

  const applyLatest = useCallback(
    (controller: SpotifyBridgeController) => {
      const latest = latestRef.current
      if (!latest.url) {
        controller.post({ type: 'pause', token: controller.token })
        if (!latest.keepAlive) destroyController()
        return
      }
      if (!readyRef.current) return

      loadUrl(controller, latest.url)
      controller.post({ type: latest.command.action, token: controller.token })
    },
    [destroyController, loadUrl],
  )

  useEffect(() => {
    const existingController = controllerRef.current
    if (existingController && !creatingRef.current) {
      if (!url) {
        if (readyRef.current) {
          existingController.post({ type: 'pause', token: existingController.token })
        }
        if (!keepAlive) destroyController()
      } else if (readyRef.current) {
        loadUrl(existingController, url)
        existingController.post({ type: command.action, token: existingController.token })
      }
      return
    }

    if (!url) {
      if (creatingRef.current) destroyController()
      return
    }
    if (creatingRef.current || !hostRef.current) return

    const attempt = attemptRef.current + 1
    attemptRef.current = attempt
    creatingRef.current = true
    setFailedUrl(null)
    resetPlaybackState()

    const initialUrl = url
    const token = createBridgeToken()
    const iframe = document.createElement('iframe')
    const channel = new MessageChannel()
    let destroyed = false
    iframe.src = SPOTIFY_BRIDGE_SRC
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'
    iframe.title = 'Spotify'
    iframe.width = '100%'
    iframe.height = '80'
    iframe.style.border = '0'

    const controller: SpotifyBridgeController = {
      token,
      post: (nextCommand) => {
        if (destroyed) return
        try {
          channel.port1.postMessage(nextCommand)
        } catch {
          failAttempt(attempt)
        }
      },
      destroy: () => {
        if (destroyed) return
        try {
          channel.port1.postMessage({ type: 'destroy', token } satisfies SpotifyBridgeCommand)
        } catch {
          // A closed channel must not keep the iframe alive.
        }
        destroyed = true
        try {
          channel.port1.close()
        } catch {
          // The iframe still needs to be detached.
        }
        try {
          channel.port2.close()
        } catch {
          // The transferred endpoint may already be detached.
        }
        iframe.remove()
      },
    }
    controllerRef.current = controller
    loadedUrlRef.current = initialUrl

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      if (
        attemptRef.current !== attempt ||
        disposedRef.current ||
        !isSpotifyBridgeEvent(event.data) ||
        event.data.token !== token
      ) {
        return
      }

      if (event.data.type === 'failure') {
        failAttempt(attempt)
        return
      }
      if (event.data.type === 'ready') {
        if (readyRef.current) return
        if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current)
        readyTimeoutRef.current = null
        creatingRef.current = false
        readyRef.current = true
        applyLatest(controller)
        return
      }
      if (event.data.type === 'playback-started') {
        startedRef.current = true
        pausedRef.current = false
        endedRef.current = false
        onPlaybackStartedRef.current()
        return
      }
      if (!startedRef.current || endedRef.current) return

      if (event.data.duration > 0 && event.data.position >= event.data.duration) {
        endedRef.current = true
        onPlaybackEndedRef.current()
        return
      }
      if (event.data.buffering) return
      if (event.data.paused && !pausedRef.current) {
        pausedRef.current = true
        onPlaybackPausedRef.current()
      } else if (!event.data.paused && pausedRef.current) {
        pausedRef.current = false
        onPlaybackStartedRef.current()
      }
    }
    channel.port1.onmessageerror = () => failAttempt(attempt)
    channel.port1.start()

    iframe.addEventListener(
      'load',
      () => {
        if (attemptRef.current !== attempt || disposedRef.current) return
        if (createTimeoutRef.current) clearTimeout(createTimeoutRef.current)
        createTimeoutRef.current = null
        const bridgeWindow = iframe.contentWindow
        if (!bridgeWindow) {
          failAttempt(attempt)
          return
        }

        readyTimeoutRef.current = setTimeout(() => failAttempt(attempt), SPOTIFY_BRIDGE_TIMEOUT_MS)
        try {
          // Opaque sandbox origins require "*"; the exact iframe receives a private token-bound port.
          // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
          bridgeWindow.postMessage({ type: 'spotify-bridge-init', token, url: initialUrl }, '*', [
            channel.port2,
          ])
        } catch {
          failAttempt(attempt)
        }
      },
      { once: true },
    )
    createTimeoutRef.current = setTimeout(() => failAttempt(attempt), SPOTIFY_BRIDGE_TIMEOUT_MS)
    hostRef.current.replaceChildren(iframe)
  }, [
    url,
    keepAlive,
    command,
    applyLatest,
    destroyController,
    failAttempt,
    loadUrl,
    resetPlaybackState,
  ])

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      destroyController()
    }
  }, [destroyController])

  return { hostRef, failed: Boolean(url && failedUrl === url) }
}
