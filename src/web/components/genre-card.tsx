import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { hueFromName } from '../lib/utils'

export type GenreCardProps = {
  name: string
  slug: string
  artistCount: number
  exampleArtists?: string[]
}

export function GenreCard({ name, slug, artistCount, exampleArtists }: GenreCardProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const hue = hueFromName(name)

  return (
    <button
      type="button"
      onClick={() => navigate(`/genres/${slug}`)}
      className="bg-surface border border-border rounded-lg p-4 text-left hover:border-accent/60 transition-colors group w-full"
      style={{ borderTopColor: `hsl(${hue}, 45%, 45%)`, borderTopWidth: '3px' }}
    >
      <p
        className="text-sm font-semibold text-text group-hover:text-accent transition-colors truncate"
        title={name}
      >
        {name}
      </p>
      <p className="text-xs text-muted mt-1">
        {artistCount === 1
          ? t('genres.artistCountSingular').replace('{0}', '1')
          : t('genres.artistCountPlural').replace('{0}', String(artistCount))}
      </p>
      {exampleArtists && exampleArtists.length > 0 && (
        <p className="text-micro-lg text-muted/70 mt-1.5 truncate">{exampleArtists.join(', ')}</p>
      )}
    </button>
  )
}
