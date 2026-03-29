import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

export type PreviewSource = {
  type: 'spotify-embed' | 'deezer-audio' | 'youtube-embed'
  url: string
  embedUrl: string
}

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

function resolveSpotifyEmbed(spotifyUrl: string): PreviewSource | null {
  const match = spotifyUrl.match(/spotify\.com\/(artist|album|track)\/([A-Za-z0-9]+)/)
  if (!match?.[1] || !match?.[2]) return null
  return {
    type: 'spotify-embed',
    url: spotifyUrl,
    embedUrl: `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=generator&theme=0&autoPlay=true`,
  }
}

/**
 * Attempt to fetch a Deezer preview. The Deezer public API does NOT send
 * CORS headers, so this will fail in most browsers. It works from non-browser
 * contexts (tests, SSR) and some browsers with relaxed CORS policies.
 * When it fails, the preview chain falls through to YouTube embed.
 */
async function resolveDeezerPreview(artistName: string): Promise<PreviewSource | null> {
  try {
    const encoded = encodeURIComponent(artistName)
    const res = await fetch(`https://api.deezer.com/search?q=artist:"${encoded}"&limit=1`)
    if (!res.ok) return null
    const data = (await res.json()) as { data?: Array<{ preview?: string }> }
    const track = data?.data?.[0]
    if (!track?.preview) return null
    return { type: 'deezer-audio', url: track.preview, embedUrl: track.preview }
  } catch {
    return null
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

export async function resolvePreviewSource(
  streamingUrls: Record<string, string> | null,
  artistName: string,
): Promise<PreviewSource | null> {
  if (!streamingUrls) return null

  if (streamingUrls.spotify) {
    const source = resolveSpotifyEmbed(streamingUrls.spotify)
    if (source) return source
  }

  const deezer = await resolveDeezerPreview(artistName)
  if (deezer) return deezer

  if (streamingUrls.youtube) {
    const source = resolveYouTubeEmbed(streamingUrls.youtube)
    if (source) return source
  }

  return null
}

// Hook

/**
 * Manages music preview playback state.
 *
 * Resolves the best available source in priority order: Spotify embed ->
 * Deezer 30-sec audio preview -> YouTube embed. For deezer-audio sources an
 * HTMLAudioElement is managed internally; embed sources (spotify/youtube)
 * require the consumer to render an iframe using `state.source.embedUrl`.
 */
export function usePreview() {
  const [state, setState] = useState<PreviewState>(INITIAL_STATE)
  const stateRef = useRef<PreviewState>(INITIAL_STATE)
  const currentMbidRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Keep stateRef in sync so callbacks don't close over stale state
  const setStateAndRef = useCallback((updater: (s: PreviewState) => PreviewState) => {
    setState((prev) => {
      const next = updater(prev)
      stateRef.current = next
      return next
    })
  }, [])

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    currentMbidRef.current = null
    setStateAndRef(() => INITIAL_STATE)
  }, [setStateAndRef])

  const play = useCallback(
    async (
      mbid: string,
      artistName: string,
      streamingUrls: Record<string, string> | null,
    ): Promise<void> => {
      // Toggle pause if same artist is already playing
      if (currentMbidRef.current === mbid && stateRef.current.playing) {
        audioRef.current?.pause()
        setStateAndRef((s) => ({ ...s, playing: false }))
        return
      }

      // Resume if same artist is paused
      if (currentMbidRef.current === mbid && !stateRef.current.playing && stateRef.current.source) {
        if (stateRef.current.source.type === 'deezer-audio' && audioRef.current) {
          await audioRef.current.play()
          setStateAndRef((s) => ({ ...s, playing: true }))
          return
        }
        // For embeds, just flip playing flag -- iframe handles playback
        setStateAndRef((s) => ({ ...s, playing: true }))
        return
      }

      // New artist: stop whatever was playing
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }

      const targetMbid = mbid
      currentMbidRef.current = mbid
      setStateAndRef(() => ({
        playing: false,
        artistMbid: mbid,
        artistName,
        source: null,
        loading: true,
        error: null,
      }))

      const source = await resolvePreviewSource(streamingUrls, artistName)

      // Guard: user started a different preview while we were resolving
      if (currentMbidRef.current !== targetMbid) return

      if (!source) {
        setStateAndRef(() => INITIAL_STATE)
        toast.error('No preview available for this artist')
        return
      }

      if (source.type === 'deezer-audio') {
        const audio = new Audio(source.url)
        audioRef.current = audio
        audio.onended = () => setStateAndRef((s) => ({ ...s, playing: false }))
        audio.onerror = () =>
          setStateAndRef((s) => ({ ...s, playing: false, error: 'Audio playback failed.' }))
        try {
          await audio.play()
          setStateAndRef((s) => ({ ...s, source, loading: false, playing: true }))
        } catch {
          setStateAndRef(() => INITIAL_STATE)
          toast.error('Playback blocked by browser -- try clicking again')
        }
        return
      }

      // Embed source: component renders the iframe; just expose the source
      setStateAndRef((s) => ({ ...s, source, loading: false, playing: true }))
    },
    [setStateAndRef],
  )

  const hasPreview = useCallback((streamingUrls: Record<string, string> | null): boolean => {
    if (!streamingUrls) return false
    return Boolean(streamingUrls.spotify || streamingUrls.deezer || streamingUrls.youtube)
  }, [])

  return { state, play, stop, hasPreview }
}
