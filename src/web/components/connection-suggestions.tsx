import { X } from 'lucide-react'

type Suggestion = {
  id: string
  label: string
}

const SERVICE_SUGGESTIONS: Record<string, Suggestion[]> = {
  spotify: [
    { id: 'discover-weekly', label: 'Set up a Discover Weekly subscription' },
    { id: 'release-radar', label: 'Enable Release Radar subscription' },
  ],
  lastfm: [{ id: 'top-genre-tags', label: 'Subscribe to your top genre tags' }],
  listenbrainz: [
    { id: 'weekly-jams', label: 'Enable Weekly Jams subscription' },
    { id: 'weekly-exploration', label: 'Enable Weekly Exploration' },
  ],
  jellyfin: [{ id: 'jellyfin-digest', label: 'Create a weekly Digarr Digest playlist' }],
  navidrome: [{ id: 'navidrome-digest', label: 'Create a weekly Digarr Digest playlist' }],
  plex: [{ id: 'plex-digest', label: 'Create a weekly Digarr Digest playlist' }],
}

const SERVICE_DISPLAY: Record<string, string> = {
  spotify: 'Spotify',
  lastfm: 'Last.fm',
  listenbrainz: 'ListenBrainz',
  jellyfin: 'Jellyfin',
  navidrome: 'Navidrome',
  plex: 'Plex',
}

type ConnectionSuggestionsProps = {
  service: string
  onClose: () => void
}

export function ConnectionSuggestions({ service, onClose }: ConnectionSuggestionsProps) {
  const suggestions = SERVICE_SUGGESTIONS[service] ?? []
  const displayName = SERVICE_DISPLAY[service] ?? service

  if (suggestions.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Suggestions for {displayName}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close suggestions"
          className="text-muted hover:text-text transition-colors"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <ul className="list-disc list-inside space-y-1.5">
        {suggestions.map((s) => (
          <li key={s.id} className="text-sm text-text">
            {s.label}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 bg-accent text-accent-fg rounded text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Got it
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-text transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
