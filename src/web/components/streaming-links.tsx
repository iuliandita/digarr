import { useContext, useState } from 'react'
import { isHttpUrl } from '@/core/validation'
import { useI18n } from '../lib/i18n'
import { PreviewContext } from '../lib/preview-context'
import { Button } from './ui/button'

type StreamingLinksProps = {
  streamingUrls: Record<string, string> | null
  artistName: string
  compact?: boolean
  onPlay?: () => void
  isPlaying?: boolean
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

type SpotifyEmbedProps = {
  url: string
}

function extractSpotifyId(url: string): { type: string; id: string } | null {
  const match = url.match(/spotify\.com\/(artist|album|track)\/([A-Za-z0-9]+)/)
  if (!match?.[1] || !match[2]) return null
  return { type: match[1], id: match[2] }
}

function SpotifyEmbed({ url }: SpotifyEmbedProps) {
  const { t } = useI18n()
  const preview = useContext(PreviewContext)
  const [activated, setActivated] = useState(false)
  const parsed = extractSpotifyId(url)
  if (!parsed) return null
  if (!activated) {
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
      </div>
    )
  }
  const embedUrl = `https://open.spotify.com/embed/${parsed.type}/${parsed.id}?utm_source=generator`
  return (
    <iframe
      src={embedUrl}
      width="100%"
      height="84"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      className="rounded border border-border mt-2"
      title={t('streaming.spotifyEmbedTitle')}
    />
  )
}

export function StreamingLinks({
  streamingUrls,
  artistName,
  compact = false,
  onPlay,
  isPlaying = false,
}: StreamingLinksProps) {
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
      {!compact && spotifyUrl && <SpotifyEmbed url={spotifyUrl} />}
    </div>
  )
}
