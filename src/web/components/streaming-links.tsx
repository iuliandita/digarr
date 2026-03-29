import { isHttpUrl } from '@/core/validation'

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
    color: '#1db954',
    fallback: (name) => `https://open.spotify.com/search/${encodeURIComponent(name)}`,
  },
  youtube: {
    label: 'YT Music',
    color: '#ff0000',
    fallback: (name) => `https://music.youtube.com/search?q=${encodeURIComponent(name)}`,
  },
  appleMusic: {
    label: 'Apple Music',
    color: '#fc3c44',
    fallback: (name) => `https://music.apple.com/search?term=${encodeURIComponent(name)}`,
  },
  deezer: {
    label: 'Deezer',
    color: '#a238ff',
    fallback: (name) => `https://www.deezer.com/search/${encodeURIComponent(name)}`,
  },
  tidal: {
    label: 'Tidal',
    color: '#00ffff',
    fallback: () => '',
  },
  soundcloud: {
    label: 'SoundCloud',
    color: '#ff5500',
    fallback: () => '',
  },
  bandcamp: {
    label: 'Bandcamp',
    color: '#1da0c3',
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
  if (!match || !match[1] || !match[2]) return null
  return { type: match[1], id: match[2] }
}

function SpotifyEmbed({ url }: SpotifyEmbedProps) {
  const parsed = extractSpotifyId(url)
  if (!parsed) return null
  const embedUrl = `https://open.spotify.com/embed/${parsed.type}/${parsed.id}?utm_source=generator`
  return (
    <iframe
      src={embedUrl}
      width="100%"
      height="84"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      className="rounded border border-border mt-2"
      title="Spotify preview"
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
      links.push({ key, label: key, url, color: '#6b7084' })
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
            className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold border border-green-500/40 text-green-500 bg-surface/50 hover:opacity-80 transition-opacity"
          >
            {isPlaying ? 'STOP' : 'PLAY'}
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
            className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold border bg-surface/50 hover:opacity-80 transition-opacity"
          >
            {SERVICE_INITIALS[key] ?? label.slice(0, 2).toUpperCase()}
          </a>
        ))}
      </div>
      {!compact && spotifyUrl && <SpotifyEmbed url={spotifyUrl} />}
    </div>
  )
}
