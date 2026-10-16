import { Bell, BrainCircuit } from 'lucide-react'
import { useState } from 'react'

function ServiceLogo({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span
        aria-hidden={alt ? undefined : true}
        className="flex items-center justify-center w-6 h-6 rounded bg-surface text-micro font-bold text-muted"
      >
        {alt.charAt(0) || '?'}
      </span>
    )
  }
  return <img src={src} alt={alt} className="w-6 h-6 rounded" onError={() => setFailed(true)} />
}

export function LidarrIcon() {
  return <ServiceLogo src="/icons/lidarr.png" alt="Lidarr" />
}

export function ListenBrainzIcon() {
  return <ServiceLogo src="/icons/listenbrainz.png" alt="ListenBrainz" />
}

export function LastfmIcon() {
  return <ServiceLogo src="/icons/lastfm.svg" alt="Last.fm" />
}

export function AiProviderIcon() {
  return (
    <span className="flex items-center justify-center w-6 h-6 text-accent">
      <BrainCircuit size={18} aria-hidden="true" />
    </span>
  )
}

export function SpotifyIcon() {
  return <ServiceLogo src="/icons/spotify.svg" alt="Spotify" />
}

export function DeezerIcon() {
  return <ServiceLogo src="/icons/deezer.svg" alt="Deezer" />
}

export function PlexIcon() {
  return <ServiceLogo src="/icons/plex.svg" alt="Plex" />
}

export function JellyfinIcon() {
  return <ServiceLogo src="/icons/jellyfin.svg" alt="Jellyfin" />
}

export function DiscogsIcon() {
  return <ServiceLogo src="/icons/discogs.svg" alt="Discogs" />
}

export function EmbyIcon() {
  return <ServiceLogo src="/icons/emby.svg" alt="Emby" />
}

export function SubsonicIcon() {
  return <ServiceLogo src="/icons/subsonic.svg" alt="Subsonic" />
}

// Inline so the mark follows the theme text color; an <img> leaves it black on dark themes.
export function TidalIcon() {
  return (
    <span className="flex items-center justify-center w-6 h-6 text-text">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M12.012 3.992 8.008 7.996 4.004 3.992 0 7.996 4.004 12l4.004-4.004L12.012 12l-4.004 4.004 4.004 4.004 4.004-4.004L12.012 12l4.004-4.004-4.004-4.004zM16.042 7.996l3.979-3.979L24 7.996l-3.979 3.979z" />
      </svg>
    </span>
  )
}

export function WebhookIcon() {
  return (
    <span className="flex items-center justify-center w-6 h-6 text-svc-webhook">
      <Bell size={18} />
    </span>
  )
}
