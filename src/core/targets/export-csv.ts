import { cellSafe } from '@/core/csv/cell-safe'
import type { ExportableRecommendation } from './types'

export function exportToCsv(recommendations: ExportableRecommendation[]): string {
  const header = 'artist,mbid,genres,score,status,date'
  const rows = recommendations.map((r) =>
    [
      cellSafe(r.artistName),
      cellSafe(r.artistMbid),
      cellSafe(r.genres.join(';')),
      cellSafe(r.score.toFixed(2)),
      cellSafe(r.status),
      cellSafe(r.createdAt),
    ].join(','),
  )
  return [header, ...rows].join('\n')
}
