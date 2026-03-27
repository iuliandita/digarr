import type { LibraryStats } from '../lib/api'

function formatBytes(bytes: number): string {
  if (bytes >= 1_099_511_627_776) return `${(bytes / 1_099_511_627_776).toFixed(1)} TB`
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${bytes} B`
}

// LibraryStatsDisplay

type Props = {
  stats: LibraryStats
}

const TOP_GENRES = 15

export function LibraryStatsDisplay({ stats }: Props) {
  const topGenres = stats.genreDistribution.slice(0, TOP_GENRES)
  const maxCount = topGenres[0]?.count ?? 1

  const totalFreeSpace = stats.rootFolders.reduce((sum, f) => sum + f.freeSpace, 0)

  type StatCard = { label: string; value: number | string; subValue?: string }
  const statCards: StatCard[] = [
    { label: 'Artists', value: stats.totalArtists },
    {
      label: 'Monitored',
      value: stats.monitoredArtists,
      subValue:
        stats.totalArtists > 0
          ? `${Math.round((stats.monitoredArtists / stats.totalArtists) * 100)}%`
          : '--',
    },
    ...(stats.totalAlbums > 0 ? [{ label: 'Albums', value: stats.totalAlbums }] : []),
    {
      label: 'Free Space',
      value: totalFreeSpace > 0 ? formatBytes(totalFreeSpace) : '--',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Stat grid */}
      <div
        className={`grid grid-cols-2 gap-4 ${statCards.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
      >
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-surface border border-border rounded-lg p-4 space-y-1"
          >
            <p className="text-xs text-muted uppercase tracking-wide">{card.label}</p>
            <p className="text-2xl font-bold text-text">{card.value}</p>
            {card.subValue !== undefined && <p className="text-xs text-muted">{card.subValue}</p>}
          </div>
        ))}
      </div>

      {/* Genre distribution */}
      {topGenres.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text uppercase tracking-wide">
            Genre Distribution
          </h3>
          <div className="bg-surface border border-border rounded-lg p-4 space-y-2.5">
            {topGenres.map((g) => (
              <div key={g.genre} className="flex items-center gap-3">
                <span className="w-32 text-sm text-text truncate shrink-0" title={g.genre}>
                  {g.genre}
                </span>
                <div className="flex-1 h-4 bg-bg rounded overflow-hidden">
                  <div
                    className="h-full bg-accent rounded transition-all"
                    style={{ width: `${Math.round((g.count / maxCount) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted w-10 text-right shrink-0">{g.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Root folders */}
      {stats.rootFolders.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-text uppercase tracking-wide">Root Folders</h3>
          <div className="bg-surface border border-border rounded-lg divide-y divide-border">
            {stats.rootFolders.map((folder) => (
              <div key={folder.path} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-sm text-text font-mono truncate">{folder.path}</span>
                <span className="text-xs text-muted shrink-0">
                  {folder.freeSpace > 0 ? `${formatBytes(folder.freeSpace)} free` : 'unknown'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
