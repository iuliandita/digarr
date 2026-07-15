import { useCallback, useEffect, useRef, useState } from 'react'

const SPOTIFY_IFRAME_API_SRC = 'https://open.spotify.com/embed/iframe-api/v1'
const SPOTIFY_API_TIMEOUT_MS = 10_000

export type SpotifyPlaybackCommand = {
  id: number
  action: 'play' | 'pause'
}

type SpotifyPlaybackEvent = {
  data: {
    isPaused?: boolean
    isBuffering?: boolean
    duration?: number
    position?: number
    playingURI?: string
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

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void
  }
}

let spotifyIframeApiPromise: Promise<SpotifyIframeApi> | null = null

function loadSpotifyIframeApi(): Promise<SpotifyIframeApi> {
  if (spotifyIframeApiPromise) return spotifyIframeApiPromise

  spotifyIframeApiPromise = new Promise((resolve, reject) => {
    let settled = false
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SPOTIFY_IFRAME_API_SRC}"]`,
    )
    const script = existing ?? document.createElement('script')

    const clearCallback = () => {
      if (window.onSpotifyIframeApiReady === handleReady) {
        delete window.onSpotifyIframeApiReady
      }
    }
    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearCallback()
      script.remove()
      spotifyIframeApiPromise = null
      reject(new Error('Spotify iframe API failed to load'))
    }
    const handleReady = (api: SpotifyIframeApi) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearCallback()
      resolve(api)
    }
    const timeout = setTimeout(fail, SPOTIFY_API_TIMEOUT_MS)

    window.onSpotifyIframeApiReady = handleReady
    script.addEventListener('error', fail, { once: true })
    if (!existing) {
      script.src = SPOTIFY_IFRAME_API_SRC
      script.async = true
      document.body.append(script)
    }
  })

  return spotifyIframeApiPromise
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
  const controllerRef = useRef<SpotifyEmbedController | null>(null)
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

  const loadUrl = useCallback((controller: SpotifyEmbedController, nextUrl: string) => {
    if (loadedUrlRef.current === nextUrl) return
    controller.loadEntity(nextUrl)
    loadedUrlRef.current = nextUrl
    startedRef.current = false
    pausedRef.current = false
    endedRef.current = false
  }, [])

  const applyLatest = useCallback(
    (controller: SpotifyEmbedController) => {
      const latest = latestRef.current
      if (!latest.url) {
        controller.pause()
        if (!latest.keepAlive) destroyController()
        return
      }
      if (!readyRef.current) return

      loadUrl(controller, latest.url)
      controller[latest.command.action]()
    },
    [destroyController, loadUrl],
  )

  const attachListeners = useCallback((controller: SpotifyEmbedController, attempt: number) => {
    controller.addListener('playback_started', () => {
      if (attemptRef.current !== attempt) return
      startedRef.current = true
      pausedRef.current = false
      endedRef.current = false
      onPlaybackStartedRef.current()
    })
    controller.addListener('playback_update', (event) => {
      if (attemptRef.current !== attempt || !startedRef.current || endedRef.current) return

      const duration = event.data.duration ?? 0
      const position = event.data.position ?? 0
      if (duration > 0 && position >= duration) {
        endedRef.current = true
        onPlaybackEndedRef.current()
        return
      }
      if (event.data.isBuffering) return
      if (event.data.isPaused === true && !pausedRef.current) {
        pausedRef.current = true
        onPlaybackPausedRef.current()
      } else if (event.data.isPaused === false && pausedRef.current) {
        pausedRef.current = false
        onPlaybackStartedRef.current()
      }
    })
  }, [])

  useEffect(() => {
    const controller = controllerRef.current
    if (controller) {
      if (!url) {
        if (readyRef.current) controller.pause()
        if (!keepAlive) destroyController()
      } else if (readyRef.current) {
        loadUrl(controller, url)
        controller[command.action]()
      }
      return
    }

    if (!url) {
      if (creatingRef.current) {
        attemptRef.current += 1
        creatingRef.current = false
        clearControllerTimeouts()
      }
      return
    }
    if (creatingRef.current || !hostRef.current) return

    const attempt = attemptRef.current + 1
    attemptRef.current = attempt
    creatingRef.current = true
    setFailedUrl(null)

    void loadSpotifyIframeApi()
      .then((api) => {
        if (attemptRef.current !== attempt || disposedRef.current) return

        const host = hostRef.current
        const initialUrl = latestRef.current.url
        if (!host || !initialUrl) {
          creatingRef.current = false
          return
        }

        host.replaceChildren()
        const target = document.createElement('div')
        host.append(target)
        createTimeoutRef.current = setTimeout(() => failAttempt(attempt), SPOTIFY_API_TIMEOUT_MS)

        api.createController(
          target,
          { url: initialUrl, width: '100%', height: 80 },
          (createdController) => {
            if (attemptRef.current !== attempt || disposedRef.current) {
              createdController.destroy()
              return
            }

            if (createTimeoutRef.current) clearTimeout(createTimeoutRef.current)
            createTimeoutRef.current = null
            creatingRef.current = false
            controllerRef.current = createdController
            resetPlaybackState()
            loadedUrlRef.current = initialUrl
            attachListeners(createdController, attempt)
            readyTimeoutRef.current = setTimeout(() => failAttempt(attempt), SPOTIFY_API_TIMEOUT_MS)
            createdController.addListener('ready', () => {
              if (attemptRef.current !== attempt || disposedRef.current) return
              if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current)
              readyTimeoutRef.current = null
              readyRef.current = true
              applyLatest(createdController)
            })
          },
        )
      })
      .catch(() => failAttempt(attempt))
  }, [
    url,
    keepAlive,
    command,
    applyLatest,
    attachListeners,
    clearControllerTimeouts,
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
