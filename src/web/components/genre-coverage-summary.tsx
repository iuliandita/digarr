import type { GenreCoverage } from '../lib/api'
import { useI18n } from '../lib/i18n'

export function GenreCoverageSummary({ coverage }: { coverage: GenreCoverage | null | undefined }) {
  const { t } = useI18n()
  if (!coverage || coverage.totalArtists === 0) return null

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted">
        {t('dashboard.genreCoverage')
          .replace('{0}', String(coverage.coveredArtists))
          .replace('{1}', String(coverage.totalArtists))}
      </p>
      {coverage.pendingArtists > 0 ? (
        <p className="text-xs text-muted">
          {t('dashboard.genreCoveragePending').replace('{0}', String(coverage.pendingArtists))}
        </p>
      ) : null}
    </div>
  )
}
