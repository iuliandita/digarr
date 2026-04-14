import type { GenreInfo } from '../../core/genre/types'
import { useI18n } from '../lib/i18n'
import { GenreCard } from './genre-card'
import { Skeleton } from './ui/skeleton'

type GenreWithExamples = GenreInfo & { exampleArtists?: string[] }

type GenreGridProps = {
  genres: GenreWithExamples[]
  loading?: boolean
}

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'] as const

function GenreSkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {SKELETON_KEYS.map((k) => (
        <div key={k} className="bg-surface border border-border rounded-lg p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

export function GenreGrid({ genres, loading = false }: GenreGridProps) {
  const { t } = useI18n()
  if (loading) {
    return <GenreSkeletonGrid />
  }

  if (genres.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted text-sm">{t('genres.noneFound')}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {genres.map((g) => (
        <GenreCard
          key={g.id}
          name={g.name}
          slug={g.slug}
          artistCount={g.artistCount}
          exampleArtists={g.exampleArtists}
        />
      ))}
    </div>
  )
}
