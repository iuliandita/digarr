import { Pause, Play, Zap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { SearchResult } from '../lib/api'
import { quickDiscover } from '../lib/api'
import { GENRE_COLORS } from '../lib/constants'
import { useI18n } from '../lib/i18n'
import { usePreviewContext } from '../lib/preview-context'
import { cn } from '../lib/utils'
import { ArtistThumb } from './artist-thumb'

// Source badge config

const SOURCE_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  spotify: { label: 'Spotify', bg: 'bg-green-500/20', text: 'text-green-400' },
  deezer: { label: 'Deezer', bg: 'bg-pink-500/20', text: 'text-pink-400' },
  musicbrainz: { label: 'MusicBrainz', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  tidal: { label: 'TIDAL', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  bandcamp: { label: 'Bandcamp', bg: 'bg-teal-500/20', text: 'text-teal-400' },
}

// SearchResultCard

type SearchResultCardProps = {
  result: SearchResult
}

export function SearchResultCard({ result }: SearchResultCardProps) {
  const { t } = useI18n()
  const { play, stop, currentMbid, playing } = usePreviewContext()
  const [queuing, setQueuing] = useState(false)
  const [queued, setQueued] = useState(false)

  const imageUrl = result.images[0]?.url ?? null

  // Build a streaming URLs map from sources for preview resolution
  const streamingUrls: Record<string, string> | null = result.sources.reduce<
    Record<string, string>
  >((acc, s) => {
    if (s.url && (s.id === 'spotify' || s.id === 'deezer' || s.id === 'tidal')) {
      acc[s.id] = s.url
    }
    return acc
  }, {})
  const hasStreaming = Object.keys(streamingUrls).length > 0

  const isPlaying = currentMbid === (result.mbid ?? result.name) && playing

  function handlePreview() {
    if (!result.mbid && !result.name) return
    const id = result.mbid ?? result.name
    if (isPlaying) {
      stop()
    } else {
      play(id, result.name, hasStreaming ? streamingUrls : null)
    }
  }

  async function handleQuickDiscover() {
    setQueuing(true)
    try {
      await quickDiscover(result.name)
      setQueued(true)
      toast.success(t('searchResultCard.queuedSuccess').replace('{0}', result.name))
    } catch {
      toast.error(t('searchResultCard.queuedFailure').replace('{0}', result.name))
    } finally {
      setQueuing(false)
    }
  }

  const alreadyHandled = result.inLibrary || result.inRecommendations || queued

  return (
    <div className="bg-surface border border-border rounded-lg p-3 flex gap-3 hover:border-accent/30 transition-colors">
      {/* Thumbnail */}
      <div className="shrink-0">
        <ArtistThumb name={result.name} imageUrl={imageUrl} size={12} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Name + status badges */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-text text-sm leading-tight truncate">{result.name}</h3>
          <div className="flex items-center gap-1 shrink-0">
            {result.inLibrary && (
              <span className="text-micro px-1.5 py-0.5 rounded bg-approve/15 text-approve font-medium">
                {t('discover.inLibrary')}
              </span>
            )}
            {(result.inRecommendations || queued) && !result.inLibrary && (
              <span className="text-micro px-1.5 py-0.5 rounded bg-info/15 text-info font-medium">
                {t('genreDetail.inQueue')}
              </span>
            )}
          </div>
        </div>

        {/* Genres */}
        {result.genres.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {result.genres.slice(0, 4).map((g, i) => (
              <span
                key={g}
                className={cn(
                  'text-micro px-1.5 py-0.5 rounded font-medium',
                  GENRE_COLORS[i % GENRE_COLORS.length],
                )}
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {/* Source badges */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {result.sources.map((s) => {
            const style = SOURCE_STYLES[s.id] ?? {
              label: s.id,
              bg: 'bg-border',
              text: 'text-muted',
            }
            const badge = (
              <span
                className={cn(
                  'text-micro px-1.5 py-0.5 rounded font-medium',
                  style.bg,
                  style.text,
                  s.url ? 'cursor-pointer hover:opacity-80 transition-opacity' : '',
                )}
              >
                {style.label}
              </span>
            )
            if (s.url) {
              return (
                <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer">
                  {badge}
                </a>
              )
            }
            return <span key={s.id}>{badge}</span>
          })}

          {typeof result.popularity === 'number' && (
            <span className="text-micro px-1.5 py-0.5 rounded bg-border text-muted font-medium">
              {t('searchResultCard.popularity')
                .replace('{0}', String(result.popularity))
                .replace('{1}', '%')}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-2">
          {hasStreaming && (
            <button
              type="button"
              onClick={handlePreview}
              className="flex items-center gap-1 text-micro-lg text-muted hover:text-text transition-colors"
              title={isPlaying ? t('recommendation.stopPreview') : t('recommendation.playPreview')}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
              {isPlaying ? t('recommendation.stopPreview') : t('recommendation.playPreview')}
            </button>
          )}

          {!alreadyHandled && (
            <button
              type="button"
              onClick={handleQuickDiscover}
              disabled={queuing}
              className="flex items-center gap-1 text-micro-lg text-accent hover:opacity-80 transition-opacity disabled:opacity-50"
              title={t('searchResultCard.addToQueue')}
            >
              <Zap size={12} />
              {queuing ? t('searchResultCard.queuing') : t('jobHistory.quickDiscover')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
