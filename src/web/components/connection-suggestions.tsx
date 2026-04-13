import { X } from 'lucide-react'
import type { MessageKey } from '@/core/i18n/messages/types'
import { useI18n } from '@/web/lib/i18n'

type Suggestion = {
  id: string
  labelKey: MessageKey
}

const SERVICE_SUGGESTIONS: Record<string, Suggestion[]> = {
  spotify: [
    { id: 'discover-weekly', labelKey: 'connectionSuggestions.spotifyDiscoverWeekly' },
    { id: 'release-radar', labelKey: 'connectionSuggestions.spotifyReleaseRadar' },
  ],
  lastfm: [{ id: 'top-genre-tags', labelKey: 'connectionSuggestions.lastfmTopGenreTags' }],
  listenbrainz: [
    { id: 'weekly-jams', labelKey: 'connectionSuggestions.listenbrainzWeeklyJams' },
    {
      id: 'weekly-exploration',
      labelKey: 'connectionSuggestions.listenbrainzWeeklyExploration',
    },
  ],
  jellyfin: [{ id: 'jellyfin-digest', labelKey: 'connectionSuggestions.weeklyDigestPlaylist' }],
  navidrome: [{ id: 'navidrome-digest', labelKey: 'connectionSuggestions.weeklyDigestPlaylist' }],
  plex: [{ id: 'plex-digest', labelKey: 'connectionSuggestions.weeklyDigestPlaylist' }],
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
  const { t } = useI18n()
  const suggestions = SERVICE_SUGGESTIONS[service] ?? []
  const displayName = SERVICE_DISPLAY[service] ?? service

  if (suggestions.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">
          {t('connectionSuggestions.title').replace('{0}', displayName)}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('connectionSuggestions.close')}
          className="text-muted hover:text-text transition-colors"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <ul className="list-disc list-inside space-y-1.5">
        {suggestions.map((s) => (
          <li key={s.id} className="text-sm text-text">
            {t(s.labelKey)}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 bg-accent text-accent-fg rounded text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t('connectionSuggestions.gotIt')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-text transition-colors"
        >
          {t('connectionSuggestions.skipForNow')}
        </button>
      </div>
    </div>
  )
}
