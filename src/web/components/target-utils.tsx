export function TargetIcon({ type }: { type: string }) {
  switch (type) {
    case 'lidarr':
      return <img src="/icons/lidarr.png" alt="" className="w-4 h-4" />
    case 'navidrome':
      return <img src="/icons/navidrome.svg" alt="" className="w-4 h-4" />
    case 'jellyfin':
      return <img src="/icons/jellyfin.svg" alt="" className="w-4 h-4" />
    default:
      return <div className="w-4 h-4" />
  }
}

export function canApproveArtistToTarget(type: string): boolean {
  return type === 'lidarr'
}

export function targetActionLabel(type: string, name: string): string {
  switch (type) {
    case 'lidarr':
      return `Add to ${name}`
    case 'navidrome':
    case 'jellyfin':
      return `Favorite in ${name}`
    case 'spotify-playlist':
      return 'Add to Spotify playlist'
    default:
      return `Send to ${name}`
  }
}
