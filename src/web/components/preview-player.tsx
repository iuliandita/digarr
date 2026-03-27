import { Music, X } from 'lucide-react'
import type { PreviewSource } from '@/web/hooks/use-preview'

// Source label helpers

const SOURCE_LABELS: Record<PreviewSource['type'], string> = {
  'spotify-embed': 'Spotify',
  'deezer-audio': 'Deezer',
  'youtube-embed': 'YouTube',
}

type Props = {
  playing: boolean
  artistName: string | null
  source: PreviewSource | null
  loading: boolean
  onStop: () => void
}

// PreviewPlayer

/**
 * Global mini-player bar fixed to the bottom of the viewport.
 * On mobile it sits above the 56px bottom nav (bottom-14); on md+ it sits at
 * bottom-0. Only renders when a preview is active (loading or playing).
 */
export function PreviewPlayer({ playing, artistName, source, loading, onStop }: Props) {
  if (!playing && !loading) return null

  const sourceLabel = source ? SOURCE_LABELS[source.type] : null
  const showIframe = playing && source && source.type !== 'deezer-audio'

  return (
    <section
      className="fixed bottom-14 md:bottom-0 left-0 right-0 z-50 bg-surface border-t border-border shadow-lg"
      aria-label="Preview player"
    >
      <div className="max-w-3xl mx-auto px-4 py-2">
        {/* Info row */}
        <div className="flex items-center gap-3">
          <Music size={16} className="text-muted shrink-0" aria-hidden="true" />

          <div className="flex-1 min-w-0">
            {loading && !artistName ? (
              <span className="text-sm text-muted">Loading preview...</span>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                {artistName && (
                  <span className="text-sm text-text font-medium truncate">{artistName}</span>
                )}
                {loading && <span className="text-xs text-muted shrink-0">Loading...</span>}
                {!loading && sourceLabel && (
                  <span className="text-xs text-muted uppercase shrink-0">{sourceLabel}</span>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onStop}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-sm text-muted hover:text-text hover:bg-bg/50 transition-colors"
            aria-label="Close preview"
          >
            <X size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>

        {/* Embed iframe */}
        {showIframe && (
          <div className="mt-2">
            <iframe
              src={source.embedUrl}
              height={80}
              width="100%"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              title={`${artistName ?? 'Artist'} preview`}
              className="rounded"
            />
          </div>
        )}
      </div>
    </section>
  )
}
