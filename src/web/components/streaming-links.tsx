import { useContext, useEffect, useState } from 'react'
import { isHttpUrl } from '@/core/validation'
import { type AppleSong, lookupAppleSongs } from '../lib/apple-music'
import { useI18n } from '../lib/i18n'
import { PreviewContext } from '../lib/preview-context'
import { Button } from './ui/button'

type StreamingLinksProps = {
  streamingUrls: Record<string, string> | null
  artistName: string
  compact?: boolean
  onPlay?: () => void
  isPlaying?: boolean
  spotifyAutoload?: SpotifyAutoload
}

function safeUrl(url: string): string {
  return isHttpUrl(url) ? url : '#'
}

type ServiceConfig = {
  label: string
  color: string
  fallback: (name: string) => string
}

const SERVICES: Record<string, ServiceConfig> = {
  spotify: {
    label: 'Spotify',
    color: 'var(--color-svc-spotify)',
    fallback: (name) => `https://open.spotify.com/search/${encodeURIComponent(name)}`,
  },
  youtube: {
    label: 'YT Music',
    color: 'var(--color-svc-youtube)',
    fallback: (name) => `https://music.youtube.com/search?q=${encodeURIComponent(name)}`,
  },
  appleMusic: {
    label: 'Apple Music',
    color: 'var(--color-svc-apple)',
    fallback: (name) => `https://music.apple.com/search?term=${encodeURIComponent(name)}`,
  },
  deezer: {
    label: 'Deezer',
    color: 'var(--color-svc-deezer)',
    fallback: (name) => `https://www.deezer.com/search/${encodeURIComponent(name)}`,
  },
  tidal: {
    label: 'Tidal',
    color: 'var(--color-svc-tidal)',
    fallback: () => '',
  },
  soundcloud: {
    label: 'SoundCloud',
    color: 'var(--color-svc-soundcloud)',
    fallback: () => '',
  },
  bandcamp: {
    label: 'Bandcamp',
    color: 'var(--color-svc-bandcamp)',
    fallback: () => '',
  },
}

// Abbreviated initials for the icon buttons
const SERVICE_INITIALS: Record<string, string> = {
  spotify: 'SP',
  youtube: 'YT',
  appleMusic: 'AM',
  deezer: 'DZ',
  tidal: 'TD',
  soundcloud: 'SC',
  bandcamp: 'BC',
}

export type SpotifyAutoload = {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

type SpotifyEmbedProps = {
  url: string
  autoload?: SpotifyAutoload
}

function extractSpotifyId(url: string): { type: string; id: string } | null {
  const match = url.match(/spotify\.com\/(artist|album|track)\/([A-Za-z0-9]+)/)
  if (!match?.[1] || !match[2]) return null
  return { type: match[1], id: match[2] }
}

function SpotifyEmbed({ url, autoload }: SpotifyEmbedProps) {
  const { t } = useI18n()
  const preview = useContext(PreviewContext)
  const [activated, setActivated] = useState(false)
  const parsed = extractSpotifyId(url)
  if (!parsed) return null
  const autoloaded = autoload?.enabled === true
  if (!activated && !autoloaded) {
    return (
      <div className="mt-2 flex flex-col items-start gap-1 rounded border border-border bg-surface/50 p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            preview?.stop()
            setActivated(true)
          }}
        >
          {t('streaming.spotifyLoad')}
        </Button>
        <p className="text-caption text-muted">{t('streaming.spotifyLoadHint')}</p>
        {autoload && (
          <label className="flex items-center gap-2 text-caption text-muted">
            <input
              type="checkbox"
              className="accent-accent"
              checked={false}
              onChange={() => {
                autoload.onChange(true)
                setActivated(true)
              }}
            />
            {t('streaming.spotifyAutoloadOption')}
          </label>
        )}
      </div>
    )
  }
  const embedUrl = `https://open.spotify.com/embed/${parsed.type}/${parsed.id}?utm_source=generator`
  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <iframe
        src={embedUrl}
        width="100%"
        height="84"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="rounded-xl"
        title={t('streaming.spotifyEmbedTitle')}
      />
      {autoload?.enabled && (
        <button
          type="button"
          className="text-caption text-muted underline hover:text-text"
          onClick={() => {
            autoload.onChange(false)
            setActivated(false)
          }}
        >
          {t('streaming.spotifyAutoloadOff')}
        </button>
      )}
    </div>
  )
}

type AppleEmbedProps = {
  appleMusicUrl: string | undefined
  artistName: string
  autoload?: SpotifyAutoload
}

/**
 * Apple's compact song player, shown in place of the Spotify embed for users
 * with the `applePreviews` preference. Like the Spotify embed it stays a local
 * placeholder until clicked, unless the dashboard autoload preference is on.
 * Apple's artist embed has no song list, so the artist's top songs are offered
 * as buttons that swap the song in the player. It plays Apple's 30-second
 * clips only: signing in inside the embed is not supported, because Apple's
 * sign-in window cannot report back to the frame while pages are served with
 * `Cross-Origin-Opener-Policy: same-origin`.
 */
const APPLE_EMBED_SONGS = 3

function AppleEmbed({ appleMusicUrl, artistName, autoload }: AppleEmbedProps) {
  const { t } = useI18n()
  const preview = useContext(PreviewContext)
  const [activated, setActivated] = useState(false)
  const [songs, setSongs] = useState<AppleSong[] | undefined>(undefined)
  const [selected, setSelected] = useState(0)
  const wanted = activated || autoload?.enabled === true

  useEffect(() => {
    if (!wanted) return
    let current = true
    setSongs(undefined)
    setSelected(0)
    void lookupAppleSongs(appleMusicUrl, artistName).then((lookup) => {
      if (!current) return
      setSongs(
        (lookup.songs ?? [])
          .filter((song) => Number.isInteger(song.trackId))
          .slice(0, APPLE_EMBED_SONGS),
      )
    })
    return () => {
      current = false
    }
  }, [wanted, appleMusicUrl, artistName])

  if (!wanted) {
    return (
      <div className="mt-2 flex flex-col items-start gap-1 rounded border border-border bg-surface/50 p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            preview?.stop()
            setActivated(true)
          }}
        >
          {t('streaming.appleLoad')}
        </Button>
        <p className="text-caption text-muted">{t('streaming.appleLoadHint')}</p>
        {autoload && (
          <label className="flex items-center gap-2 text-caption text-muted">
            <input
              type="checkbox"
              className="accent-accent"
              checked={false}
              onChange={() => {
                autoload.onChange(true)
                setActivated(true)
              }}
            />
            {t('streaming.spotifyAutoloadOption')}
          </label>
        )}
      </div>
    )
  }
  if (songs === undefined) {
    return <p className="mt-2 text-caption text-muted">{t('common.loading')}</p>
  }
  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      {songs.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {songs.map((song, index) => (
            <button
              key={song.trackId}
              type="button"
              aria-pressed={index === selected}
              onClick={() => setSelected(index)}
              className={`max-w-48 truncate rounded border px-2 py-0.5 text-caption transition-colors ${
                index === selected
                  ? 'border-accent text-text'
                  : 'border-border text-muted hover:text-text'
              }`}
            >
              {song.trackName ?? index + 1}
            </button>
          ))}
        </div>
      )}
      {songs.length === 0 ? (
        <p className="text-caption text-muted">{t('preview.noPreviewAvailable')}</p>
      ) : (
        <iframe
          key={(songs[selected] ?? songs[0])?.trackId}
          src={`https://embed.music.apple.com/song/${(songs[selected] ?? songs[0])?.trackId}`}
          width="100%"
          height="175"
          allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write"
          sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
          loading="lazy"
          className="rounded-xl"
          title={t('streaming.appleEmbedTitle')}
        />
      )}
      {autoload?.enabled && (
        <button
          type="button"
          className="text-caption text-muted underline hover:text-text"
          onClick={() => {
            autoload.onChange(false)
            setActivated(false)
          }}
        >
          {t('streaming.spotifyAutoloadOff')}
        </button>
      )}
    </div>
  )
}

export function StreamingLinks({
  streamingUrls,
  artistName,
  compact = false,
  onPlay,
  isPlaying = false,
  spotifyAutoload,
}: StreamingLinksProps) {
  const applePreviews = useContext(PreviewContext)?.applePreviews ?? 'off'
  const { t } = useI18n()
  const urls = streamingUrls ?? {}

  // Build the list of links: prefer direct URL, fall back to search URL for known services
  const links: Array<{ key: string; label: string; url: string; color: string }> = []

  for (const [key, config] of Object.entries(SERVICES)) {
    const direct = urls[key]
    if (direct) {
      links.push({ key, label: config.label, url: direct, color: config.color })
    } else if (config.fallback(artistName)) {
      links.push({
        key,
        label: config.label,
        url: config.fallback(artistName),
        color: config.color,
      })
    }
  }

  // Also include any extra keys from streamingUrls that aren't in SERVICES
  for (const [key, url] of Object.entries(urls)) {
    if (!SERVICES[key] && url) {
      links.push({ key, label: key, url, color: 'var(--color-svc-unknown)' })
    }
  }

  if (links.length === 0) return null

  const spotifyUrl = urls.spotify

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5">
        {onPlay && (
          <button
            type="button"
            onClick={onPlay}
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-1.5 py-0.5 rounded text-micro font-bold border sm:min-h-0 sm:min-w-0 border-approve/40 text-approve bg-surface/50 hover:opacity-80 transition-opacity"
          >
            {isPlaying ? t('streaming.stopShort') : t('streaming.playShort')}
          </button>
        )}
        {links.map(({ key, label, url, color }) => (
          <a
            key={key}
            href={safeUrl(url)}
            target="_blank"
            rel="noopener noreferrer"
            title={label}
            style={{ borderColor: `${color}40`, color }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-1.5 py-0.5 rounded text-micro font-bold border sm:min-h-0 sm:min-w-0 bg-surface/50 hover:opacity-80 transition-opacity"
          >
            {SERVICE_INITIALS[key] ?? label.slice(0, 2).toUpperCase()}
          </a>
        ))}
      </div>
      {/* While the preference is unknown neither player is offered. */}
      {!compact && applePreviews === 'on' && (
        <AppleEmbed
          appleMusicUrl={streamingUrls?.appleMusic}
          artistName={artistName}
          autoload={spotifyAutoload}
        />
      )}
      {!compact && applePreviews === 'off' && spotifyUrl && (
        <SpotifyEmbed url={spotifyUrl} autoload={spotifyAutoload} />
      )}
    </div>
  )
}
