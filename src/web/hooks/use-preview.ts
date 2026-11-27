import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { APPLE_PREVIEW_HOST, lookupAppleSongs, normalizeArtistName } from '../lib/apple-music'
import { useI18n } from '../lib/i18n'
import { clampVolume, readStoredVolume, writeStoredVolume } from '../lib/preview-volume'
import type { ApplePreviewsPreference } from './use-apple-previews'
import type { SpotifyPlaybackCommand } from './use-spotify-embed'

export type PreviewSource = {
  type: 'apple-audio' | 'spotify-embed' | 'deezer-audio' | 'youtube-embed'
  url: string
  embedUrl: string
  track?: { artistName: string; trackName: string; recordingMbid?: string }
}

export type PlayOutcome =
  | 'started'
  | 'paused'
  | 'resumed'
  | 'no-source'
  | 'blocked'
  | 'failed'
  | 'superseded'
export type PreviewFailureReason =
  | 'missing-links'
  | 'no-match'
  | 'no-audio'
  | 'lookup-failed'
  | 'blocked'
  | 'playback-failed'
  | 'controller-unavailable'
export type PreviewFailure = { sequence: number; artistMbid: string; reason: PreviewFailureReason }
type PreviewResolution = { source: PreviewSource | null; reason?: PreviewFailureReason }
export type PreviewOptions = {
  /**
   * The user's `applePreviews` preference: 'on' plays Apple clips and never the
   * Spotify player; 'unknown' uses neither Apple nor Spotify. Defaults to 'off'.
   */
  applePreviews?: ApplePreviewsPreference
  /** True while an 'unknown' preference may still arrive; play() then waits for it briefly. */
  applePreviewsPending?: boolean
}

// How long play() waits for a preference that is still loading. Short, so that
// playback still follows from the user's click.
const PREFERENCE_WAIT_MS = 2000

type PreviewState = {
  playing: boolean
  artistMbid: string | null
  artistName: string | null
  source: PreviewSource | null
  loading: boolean
  error: string | null
}

const INITIAL_STATE: PreviewState = {
  playing: false,
  artistMbid: null,
  artistName: null,
  source: null,
  loading: false,
  error: null,
}

// Source resolvers

export function isAudioSource(source: PreviewSource): boolean {
  return source.type === 'apple-audio' || source.type === 'deezer-audio'
}

/**
 * 30-second preview of the artist's most popular song with a clip. The audio
 * plays through the preview proxy, because the page's CSP allows media from
 * this origin only.
 */
async function resolveApplePreview(
  appleMusicUrl: string | undefined,
  artistName: string,
): Promise<PreviewResolution> {
  const lookup = await lookupAppleSongs(appleMusicUrl, artistName)
  if (!lookup.songs) return { source: null, reason: lookup.reason }
  const track = lookup.songs.find(
    (r) => typeof r.previewUrl === 'string' && r.previewUrl.startsWith(APPLE_PREVIEW_HOST),
  )
  if (!track?.previewUrl) return { source: null, reason: 'no-audio' }
  return {
    source: {
      type: 'apple-audio',
      url: track.previewUrl,
      embedUrl: `/api/v1/preview/audio?${new URLSearchParams({ url: track.previewUrl }).toString()}`,
      ...(typeof track.trackName === 'string' && track.trackName.trim()
        ? { track: { artistName: track.artistName ?? artistName, trackName: track.trackName } }
        : {}),
    },
  }
}

function resolveSpotifyEmbed(spotifyUrl: string): PreviewSource | null {
  let parsed: URL
  try {
    parsed = new URL(spotifyUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'open.spotify.com') return null

  const match = parsed.pathname.match(/\/(artist|album|track)\/([A-Za-z0-9]+)(?:\/|$)/)
  if (!match?.[1] || !match?.[2]) return null
  const canonicalUrl = `https://open.spotify.com/${match[1]}/${match[2]}`
  return {
    type: 'spotify-embed',
    url: canonicalUrl,
    embedUrl: `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=generator&theme=0&autoPlay=true`,
  }
}

async function resolveDeezerPreview(artistName: string): Promise<PreviewResolution> {
  try {
    const normalize = normalizeArtistName
    // Deezer no longer answers artist:"..." queries; search plainly and keep only the
    // exact artist, since a bare name also matches covers and tributes.
    const encoded = encodeURIComponent(artistName)
    const res = await fetch(`https://api.deezer.com/search?q=${encoded}&limit=25`)
    if (!res.ok) return { source: null, reason: 'lookup-failed' }
    const data = (await res.json()) as {
      data?: Array<{ preview?: string; title?: string; artist?: { name?: string } }>
    }
    if (!Array.isArray(data?.data)) return { source: null, reason: 'lookup-failed' }
    const matches = data.data.filter(
      (t) =>
        typeof t.artist?.name === 'string' && normalize(t.artist.name) === normalize(artistName),
    )
    const track = matches.find((t) => t.preview) ?? matches[0]
    if (!track) return { source: null, reason: 'no-match' }
    if (!track.preview) return { source: null, reason: 'no-audio' }
    return {
      source: {
        type: 'deezer-audio',
        url: track.preview,
        embedUrl: track.preview,
        ...(typeof track.title === 'string' && track.title.trim()
          ? { track: { artistName: track.artist?.name ?? artistName, trackName: track.title } }
          : {}),
      },
    }
  } catch {
    return { source: null, reason: 'lookup-failed' }
  }
}

function resolveYouTubeEmbed(youtubeUrl: string): PreviewSource | null {
  const videoMatch = youtubeUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/)
  if (videoMatch?.[1]) {
    return {
      type: 'youtube-embed',
      url: youtubeUrl,
      embedUrl: `https://www.youtube.com/embed/${videoMatch[1]}?autoplay=1`,
    }
  }
  return null
}

// Public: exported for testing

async function resolvePreview(
  streamingUrls: Record<string, string> | null,
  artistName: string,
  options: PreviewOptions = {},
): Promise<PreviewResolution> {
  if (!streamingUrls || !Object.values(streamingUrls).some(Boolean))
    return { source: null, reason: 'missing-links' }

  const preference = options.applePreviews ?? 'off'
  let apple: PreviewResolution | null = null
  if (preference === 'on') {
    apple = await resolveApplePreview(streamingUrls.appleMusic, artistName)
    if (apple.source) return apple
  } else if (preference === 'off' && streamingUrls.spotify) {
    const source = resolveSpotifyEmbed(streamingUrls.spotify)
    if (source) return { source }
  }

  const deezer = await resolveDeezerPreview(artistName)
  if (deezer.source) return deezer

  if (streamingUrls.youtube) {
    const source = resolveYouTubeEmbed(streamingUrls.youtube)
    if (source) return { source }
  }

  // Apple's reason says more than the Deezer lookup's when both found nothing.
  return apple ?? deezer
}

export async function resolvePreviewSource(
  streamingUrls: Record<string, string> | null,
  artistName: string,
  options: PreviewOptions = {},
): Promise<PreviewSource | null> {
  return (await resolvePreview(streamingUrls, artistName, options)).source
}

// Hook

/**
 * Manages music preview playback state.
 *
 * Resolves the best available source in priority order: Spotify embed ->
 * Deezer 30-sec audio preview -> YouTube embed. With the `applePreviews`
 * preference an Apple 30-sec audio preview takes Spotify's place, and the
 * Spotify player is never loaded. While the preference is unknown neither
 * Apple nor Spotify is used, and play() first waits briefly for it to load.
 * Apple and Deezer audio is managed here, Spotify commands and events are
 * bridged to the persistent iframe controller, and the consumer renders
 * YouTube from `state.source.embedUrl`.
 */
export function usePreview(options: PreviewOptions = {}) {
  const applePreviewsRef = useRef<ApplePreviewsPreference>('off')
  applePreviewsRef.current = options.applePreviews ?? 'off'
  const preferencePending =
    applePreviewsRef.current === 'unknown' && options.applePreviewsPending === true
  const applePreviewsPendingRef = useRef(preferencePending)
  applePreviewsPendingRef.current = preferencePending
  const preferenceWaitersRef = useRef(new Set<() => void>())

  // Release play() calls waiting for the preference once it is known or failed.
  useEffect(() => {
    if (preferencePending) return
    for (const release of [...preferenceWaitersRef.current]) release()
  }, [preferencePending])

  const waitForPreference = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (!applePreviewsPendingRef.current) return resolve()
        const release = () => {
          clearTimeout(timer)
          preferenceWaitersRef.current.delete(release)
          resolve()
        }
        const timer = setTimeout(release, PREFERENCE_WAIT_MS)
        preferenceWaitersRef.current.add(release)
      }),
    [],
  )

  const { t } = useI18n()
  const [state, setState] = useState<PreviewState>(INITIAL_STATE)
  const stateRef = useRef<PreviewState>(INITIAL_STATE)
  const currentMbidRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const requestIdRef = useRef(0)
  const failureRef = useRef<PreviewFailure | null>(null)
  const failureSequenceRef = useRef(0)
  const [failureEvent, setFailureEvent] = useState<PreviewFailure | null>(null)
  const getLastFailure = useCallback(() => failureRef.current, [])
  const clearFailure = useCallback(() => {
    failureRef.current = null
    setFailureEvent(null)
  }, [])
  const emitFailure = useCallback((artistMbid: string, reason: PreviewFailureReason) => {
    const failure = { sequence: ++failureSequenceRef.current, artistMbid, reason }
    failureRef.current = failure
    setFailureEvent(failure)
  }, [])
  const globalPlayIdRef = useRef(0)
  const [globalPlayId, setGlobalPlayId] = useState(0)
  const [playbackEndedCount, setPlaybackEndedCount] = useState(0)
  const [spotifyCommand, setSpotifyCommand] = useState<SpotifyPlaybackCommand>({
    id: 0,
    action: 'pause',
  })
  const [volume, setVolumeState] = useState(readStoredVolume)
  const volumeRef = useRef(volume)

  // Persist the volume and apply it live to any currently-playing audio element.
  const setVolume = useCallback((next: number) => {
    const clamped = clampVolume(next)
    volumeRef.current = clamped
    setVolumeState(clamped)
    writeStoredVolume(clamped)
    if (audioRef.current) audioRef.current.volume = clamped
  }, [])

  // Keep stateRef in sync so callbacks don't close over stale state
  const setStateAndRef = useCallback((updater: (s: PreviewState) => PreviewState) => {
    setState((prev) => {
      const next = updater(prev)
      stateRef.current = next
      return next
    })
  }, [])

  const issueSpotifyCommand = useCallback((action: SpotifyPlaybackCommand['action']) => {
    setSpotifyCommand((current) => ({ id: current.id + 1, action }))
  }, [])

  const stop = useCallback(() => {
    requestIdRef.current += 1
    for (const release of [...preferenceWaitersRef.current]) release()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    issueSpotifyCommand('pause')
    currentMbidRef.current = null
    setStateAndRef(() => INITIAL_STATE)
  }, [issueSpotifyCommand, setStateAndRef])

  // Persistent in AppShell: release audio and invalidate in-flight requests on unmount.
  useEffect(
    () => () => {
      requestIdRef.current += 1
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.src = ''
        audioRef.current = null
      }
      for (const release of [...preferenceWaitersRef.current]) release()
    },
    [],
  )

  const onSpotifyPlaybackStarted = useCallback(() => {
    setStateAndRef((current) =>
      current.source?.type === 'spotify-embed' ? { ...current, playing: true } : current,
    )
  }, [setStateAndRef])

  const onSpotifyPlaybackPaused = useCallback(() => {
    setStateAndRef((current) =>
      current.source?.type === 'spotify-embed' ? { ...current, playing: false } : current,
    )
  }, [setStateAndRef])

  const onSpotifyPlaybackUnavailable = useCallback(() => {
    if (stateRef.current.source?.type !== 'spotify-embed') return
    if (!currentMbidRef.current) return
    emitFailure(currentMbidRef.current, 'controller-unavailable')
    setStateAndRef((current) => ({ ...current, playing: false }))
    setPlaybackEndedCount((count) => count + 1)
  }, [emitFailure, setStateAndRef])

  const onSpotifyPlaybackEnded = useCallback(() => {
    if (stateRef.current.source?.type !== 'spotify-embed') return
    setStateAndRef((current) => ({ ...current, playing: false }))
    setPlaybackEndedCount((count) => count + 1)
  }, [setStateAndRef])

  const play = useCallback(
    async (
      mbid: string,
      artistName: string,
      streamingUrls: Record<string, string> | null,
      opts?: { suppressErrorToast?: boolean },
    ): Promise<PlayOutcome> => {
      // Always increment globalPlayId so TopTracks local audio is cancelled
      // regardless of whether this is a new artist, resume, or toggle-pause
      globalPlayIdRef.current += 1
      setGlobalPlayId(globalPlayIdRef.current)
      clearFailure()

      // Toggle pause if same artist is already playing
      if (currentMbidRef.current === mbid && stateRef.current.playing) {
        audioRef.current?.pause()
        if (stateRef.current.source?.type === 'spotify-embed') {
          issueSpotifyCommand('pause')
        }
        setStateAndRef((s) => ({ ...s, playing: false }))
        return 'paused'
      }

      // Resume if same artist is paused
      if (currentMbidRef.current === mbid && !stateRef.current.playing && stateRef.current.source) {
        if (isAudioSource(stateRef.current.source) && audioRef.current) {
          const audio = audioRef.current
          const requestId = requestIdRef.current
          try {
            await audio.play()
          } catch (error) {
            if (requestId !== requestIdRef.current) return 'superseded'
            const blocked =
              typeof error === 'object' &&
              error !== null &&
              'name' in error &&
              error.name === 'NotAllowedError'
            emitFailure(mbid, blocked ? 'blocked' : 'playback-failed')
            if (!opts?.suppressErrorToast)
              toast.error(t(blocked ? 'preview.playbackBlocked' : 'preview.reason.playback-failed'))
            return blocked ? 'blocked' : 'failed'
          }
          if (requestId !== requestIdRef.current) return 'superseded'
          setStateAndRef((s) => ({ ...s, playing: true }))
          return 'resumed'
        }
        if (stateRef.current.source.type === 'spotify-embed') {
          issueSpotifyCommand('play')
          return 'resumed'
        }
        // YouTube embeds start through their autoplay URL.
        setStateAndRef((s) => ({ ...s, playing: true }))
        return 'resumed'
      }

      // New artist: stop whatever was playing
      const requestId = ++requestIdRef.current
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }

      currentMbidRef.current = mbid
      // Spotify only once the preference is known to be off.
      const startSpotify = (): boolean => {
        if (applePreviewsRef.current !== 'off' || !streamingUrls?.spotify) return false
        const spotifySource = resolveSpotifyEmbed(streamingUrls.spotify)
        if (!spotifySource) return false
        setStateAndRef(() => ({
          playing: false,
          artistMbid: mbid,
          artistName,
          source: spotifySource,
          loading: false,
          error: null,
        }))
        issueSpotifyCommand('play')
        return true
      }

      if (startSpotify()) return 'started'

      setStateAndRef(() => ({
        playing: false,
        artistMbid: mbid,
        artistName,
        source: null,
        loading: true,
        error: null,
      }))

      if (applePreviewsPendingRef.current) {
        await waitForPreference()
        if (requestIdRef.current !== requestId) return 'superseded'
        if (startSpotify()) return 'started'
      }

      const { source, reason } = await resolvePreview(streamingUrls, artistName, {
        applePreviews: applePreviewsRef.current,
      })

      // Guard: user started a different preview while we were resolving
      if (requestIdRef.current !== requestId) return 'superseded'

      if (!source) {
        emitFailure(mbid, reason ?? 'no-audio')
        setStateAndRef(() => INITIAL_STATE)
        if (!opts?.suppressErrorToast) toast.error(t('preview.noPreviewAvailable'))
        return 'no-source'
      }

      if (isAudioSource(source)) {
        const audio = new Audio(source.embedUrl)
        audio.volume = volumeRef.current
        audioRef.current = audio
        const isCurrent = () => requestIdRef.current === requestId && audioRef.current === audio
        let audioFailed = false
        audio.onended = () => {
          if (!isCurrent() || audioFailed) return
          setStateAndRef((s) => ({ ...s, playing: false }))
          setPlaybackEndedCount((c) => c + 1)
        }
        audio.onerror = () => {
          if (!isCurrent() || audioFailed) return
          audioFailed = true
          emitFailure(mbid, 'playback-failed')
          setStateAndRef((s) => ({
            ...s,
            playing: false,
            error: t('preview.reason.playback-failed'),
          }))
          setPlaybackEndedCount((c) => c + 1)
        }
        try {
          await audio.play()
          if (!isCurrent()) return 'superseded'
          if (audioFailed) return 'failed'
          setStateAndRef((s) => ({ ...s, source, loading: false, playing: true }))
        } catch (error) {
          if (!isCurrent()) return 'superseded'
          const blocked =
            typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'NotAllowedError'
          if (!audioFailed) emitFailure(mbid, blocked ? 'blocked' : 'playback-failed')
          audioFailed = true
          setStateAndRef(() => INITIAL_STATE)
          if (!opts?.suppressErrorToast)
            toast.error(t(blocked ? 'preview.playbackBlocked' : 'preview.reason.playback-failed'))
          return blocked ? 'blocked' : 'failed'
        }
        return 'started'
      }

      // Embed source: component renders the iframe; just expose the source
      setStateAndRef((s) => ({ ...s, source, loading: false, playing: true }))
      return 'started'
    },
    [clearFailure, emitFailure, issueSpotifyCommand, setStateAndRef, t, waitForPreference],
  )

  // Unless the preference is known to be off, any streaming link qualifies, as
  // it does for resolvePreview: the Apple and Deezer lookups can go by artist
  // name, and a preference still loading may yet allow Spotify.
  const hasPreview = useCallback((streamingUrls: Record<string, string> | null): boolean => {
    if (!streamingUrls) return false
    if (applePreviewsRef.current !== 'off') return Object.values(streamingUrls).some(Boolean)
    return Boolean(streamingUrls.spotify || streamingUrls.deezer || streamingUrls.youtube)
  }, [])

  return {
    state,
    play,
    stop,
    hasPreview,
    globalPlayId,
    playbackEndedCount,
    failureEvent,
    getLastFailure,
    clearFailure,
    spotifyCommand,
    onSpotifyPlaybackStarted,
    onSpotifyPlaybackPaused,
    onSpotifyPlaybackUnavailable,
    onSpotifyPlaybackEnded,
    volume,
    setVolume,
  }
}
