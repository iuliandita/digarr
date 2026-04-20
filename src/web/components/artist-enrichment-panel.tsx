import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import type { MessageKey } from '@/core/i18n/messages/types'
import { getArtistEnrichment } from '../lib/api'
import { useI18n } from '../lib/i18n'

const LINK_ORDER = ['wikipedia', 'officialSite', 'discogs', 'musicbrainz'] as const

export function ArtistEnrichmentPanel({ artistId, mbid }: { artistId: number; mbid: string }) {
  const { t, locale } = useI18n()
  const { data, isLoading } = useQuery({
    queryKey: ['artist-enrichment', artistId, locale],
    queryFn: () => getArtistEnrichment(artistId, locale),
    staleTime: 30 * 60 * 1000,
  })

  const linkMap: Record<string, string> = {
    ...(data?.externalLinks ?? {}),
    musicbrainz: `https://musicbrainz.org/artist/${mbid}`,
  }
  const availableLinks = LINK_ORDER.filter((k) => linkMap[k])

  if (isLoading) {
    return <div className="mt-3 h-10 animate-pulse rounded bg-surface" aria-busy="true" />
  }

  const description = data?.description ?? t('artist.noDescription')

  return (
    <div className="mt-3 space-y-2" data-testid="artist-enrichment">
      <p className="text-sm text-text" data-testid="artist-bio">
        {description}
      </p>
      {availableLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {availableLinks.map((key) => (
            <a
              key={key}
              href={linkMap[key]}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-muted px-2 py-0.5 text-xs text-muted hover:text-text"
            >
              <ExternalLink className="h-3 w-3" />
              {t(`artist.externalLinks.${key}` as MessageKey)}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
