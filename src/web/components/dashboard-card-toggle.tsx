import type { DashboardCardId } from '@/core/dashboard-layout'
import { useDashboardLayout } from '../hooks/use-dashboard-layout'
import { useI18n } from '../lib/i18n'

export function DashboardCardToggle({ cardId }: { cardId: DashboardCardId }) {
  const { layout, disabled, save, error, retry } = useDashboardLayout()
  const { t } = useI18n()
  return (
    <div>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="accent-accent"
          disabled={disabled}
          checked={layout.cards.find((card) => card.id === cardId)?.visible ?? true}
          onChange={(event) =>
            save({
              ...layout,
              cards: layout.cards.map((card) =>
                card.id === cardId ? { ...card, visible: event.target.checked } : card,
              ),
            })
          }
        />
        {t('dashboard.showOnDashboard')}
      </label>
      {error && (
        <button type="button" className="block text-sm text-accent-text underline" onClick={retry}>
          {t('errorBoundary.retry')}
        </button>
      )}
    </div>
  )
}
