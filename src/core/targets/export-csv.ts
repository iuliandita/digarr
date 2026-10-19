import { cellSafe } from '@/core/csv/cell-safe'
import type { ExportableRecommendation } from './types'

export function exportToCsv(recommendations: ExportableRecommendation[]): string {
  const header = 'artist,mbid,genres,score,status,date,recording_mbid,recording_title'
  const rows = recommendations.map((r) =>
    [
      cellSafe(r.artistName),
      cellSafe(r.artistMbid),
      cellSafe(r.genres.join(';')),
      cellSafe(r.score.toFixed(2)),
      cellSafe(r.status),
      cellSafe(r.createdAt),
      cellSafe(r.recordingMbid ?? ''),
      cellSafe(r.recordingTitle ?? ''),
    ].join(','),
  )
  return [header, ...rows].join('\n')
}
