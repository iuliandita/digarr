import { Download, Filter as FilterIcon, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { type ReactNode, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useClickOutside } from '../hooks/use-click-outside'
import { useMenu } from '../hooks/use-menu'
import { exportRecommendations } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { MENU_CLASS, MENU_ITEM_CLASS } from '../lib/menu-styles'
import { cn } from '../lib/utils'

export type ViewMode = 'grid' | 'list' | 'stack'
export type TasteOrdering = 'priority' | 'primary' | 'secondary' | 'score'
export type Decade = '60s' | '70s' | '80s' | '90s' | '00s' | '10s' | '20s+'

export const DECADES: Decade[] = ['60s', '70s', '80s', '90s', '00s', '10s', '20s+']
const APPROVE_THRESHOLD_OPTIONS = [50, 60, 70, 80, 90]

const TRIGGER_CLASS =
  'flex h-11 sm:h-9 items-center gap-1.5 rounded-control border px-3 text-body font-medium transition-colors focus-ring'

/** Sort order and decades, in one popover so the toolbar stays a single row. */
export function FiltersPopover({
  ordering,
  onOrderingChange,
  hasPrimaryGenres,
  hasSecondaryGenres,
  decades,
  onToggleDecade,
  onClearDecades,
}: {
  ordering: TasteOrdering
  onOrderingChange: (ordering: TasteOrdering) => void
  hasPrimaryGenres: boolean
  hasSecondaryGenres: boolean
  decades: Set<Decade>
  onToggleDecade: (decade: Decade) => void
  onClearDecades: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  useClickOutside(
    ref,
    () => {
      const focusInside = ref.current?.contains(document.activeElement)
      setOpen(false)
      if (focusInside) triggerRef.current?.focus()
    },
    open,
  )

  const count = decades.size + (ordering === 'score' ? 0 : 1)
  const label =
    count > 0 ? t('discover.filtersActive').replace('{0}', String(count)) : t('discover.filters')

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        aria-label={label}
        className={cn(
          TRIGGER_CLASS,
          count > 0
            ? 'border-accent/40 bg-accent/5 text-accent'
            : 'border-border bg-surface text-muted hover:text-text',
        )}
      >
        <FilterIcon size={14} aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
        {count > 0 && (
          <span aria-hidden="true" className="tabular-nums sm:hidden">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('discover.filters')}
          onBlur={(e) => {
            // Non-modal: tabbing out closes it so page shortcuts come back
            if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
          }}
          className="absolute right-0 top-full z-50 mt-2 w-72 space-y-4 rounded-surface border border-border bg-surface p-3 shadow-menu"
        >
          <label htmlFor="taste-ordering" className="block space-y-1">
            <span className="text-caption text-muted">{t('discover.tasteOrdering')}</span>
            <select
              id="taste-ordering"
              value={ordering}
              onChange={(e) => onOrderingChange(e.target.value as TasteOrdering)}
              className="block w-full rounded-control border border-border bg-bg px-2 py-1.5 text-body text-text focus-ring"
            >
              <option value="priority" disabled={!hasPrimaryGenres && !hasSecondaryGenres}>
                {t('discover.tastePriority')}
              </option>
              <option value="primary" disabled={!hasPrimaryGenres}>
                {t('discover.primaryTaste')}
              </option>
              <option value="secondary" disabled={!hasSecondaryGenres}>
                {t('discover.secondaryTaste')}
              </option>
              <option value="score">{t('discover.scoreOrder')}</option>
            </select>
          </label>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-caption text-muted">{t('discover.decadesLabel')}</legend>
            <div className="flex flex-wrap gap-1">
              {DECADES.map((decade) => (
                <button
                  key={decade}
                  type="button"
                  aria-pressed={decades.has(decade)}
                  onClick={() => onToggleDecade(decade)}
                  className={cn(
                    'min-h-11 rounded-full px-3 py-1 text-caption font-medium transition-colors focus-ring sm:min-h-0 sm:px-2',
                    decades.has(decade)
                      ? 'bg-accent text-accent-fg'
                      : 'border border-border bg-bg text-muted hover:text-text',
                  )}
                >
                  {decade}
                </button>
              ))}
            </div>
          </fieldset>
          {decades.size > 0 && (
            <button
              type="button"
              onClick={() => {
                // The button unmounts once nothing is selected; keep focus on the trigger
                triggerRef.current?.focus()
                onClearDecades()
              }}
              className="text-caption text-muted transition-colors hover:text-text"
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  onSelect,
  disabled,
  tone,
  role = 'menuitem',
  checked,
  children,
}: {
  onSelect: () => void
  disabled?: boolean
  tone?: 'reject'
  role?: 'menuitem' | 'menuitemradio'
  checked?: boolean
  children: ReactNode
}) {
  // aria-disabled, not disabled: disabled buttons cannot take focus, which breaks arrow keys.
  return (
    <button
      type="button"
      {...(role === 'menuitemradio'
        ? { role: 'menuitemradio' as const, 'aria-checked': !!checked }
        : { role: 'menuitem' as const })}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={() => {
        if (!disabled) onSelect()
      }}
      className={cn(
        MENU_ITEM_CLASS,
        disabled && 'cursor-not-allowed opacity-50',
        checked ? 'text-accent' : tone === 'reject' ? 'text-reject' : 'text-text',
      )}
    >
      {children}
    </button>
  )
}

export type BulkActions = {
  threshold: number
  onThresholdChange: (threshold: number) => void
  aboveCount: number
  belowCount: number
  auditionCount: number
  onApproveAbove: () => void
  onRejectBelow: () => void
  onAudition: () => void
  bulkMode: boolean
  onToggleBulkMode: () => void
}

/** Bulk actions and less frequent tools, kept out of the daily toolbar row. */
export function DiscoverMoreMenu({
  viewMode,
  viewOptions,
  onViewModeChange,
  bulk,
  exportStatus,
  onRefresh,
  onClearAll,
  insightsOpen,
  onToggleInsights,
}: {
  viewMode: ViewMode
  viewOptions: { mode: ViewMode; label: string }[]
  onViewModeChange: (mode: ViewMode) => void
  bulk?: BulkActions
  exportStatus?: string
  onRefresh?: () => void
  onClearAll?: () => void
  insightsOpen: boolean
  onToggleInsights: () => void
}) {
  const { t } = useI18n()
  const menu = useMenu()
  const [exporting, setExporting] = useState<string | null>(null)

  // Close first so focus returns to the trigger before any dialog takes it.
  function run(action: () => void) {
    menu.close(true)
    action()
  }

  async function handleExport(format: 'json' | 'csv' | 'm3u') {
    setExporting(format)
    try {
      await exportRecommendations(format, exportStatus ? { status: exportStatus } : undefined)
      toast.success(`${format.toUpperCase()} ${t('discover.exported')}`)
    } catch {
      toast.error(t('discover.exportFailed'))
    } finally {
      setExporting(null)
      // Only pull focus back if the user is still in the menu
      menu.close(!!menu.containerRef.current?.contains(document.activeElement))
    }
  }

  const withCount = (label: string, count: number) => (count > 0 ? `${label} (${count})` : label)

  return (
    <div ref={menu.containerRef} className="relative">
      <button
        type="button"
        {...menu.triggerProps}
        aria-label={t('discover.moreActions')}
        title={t('discover.moreActions')}
        className={cn(
          TRIGGER_CLASS,
          'w-9 justify-center border-border bg-surface px-0 text-muted hover:text-text',
        )}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {menu.open && (
        <div
          {...menu.menuProps}
          role="menu"
          aria-label={t('discover.moreActions')}
          className={cn(MENU_CLASS, 'right-0 max-h-[70vh] w-64 overflow-y-auto')}
        >
          {bulk && (
            <>
              <MenuItem disabled={bulk.aboveCount === 0} onSelect={() => run(bulk.onApproveAbove)}>
                {withCount(t('discover.approveAllAbove'), bulk.aboveCount)}
              </MenuItem>
              <MenuItem disabled={bulk.belowCount === 0} onSelect={() => run(bulk.onRejectBelow)}>
                {withCount(t('discover.rejectAllBelow'), bulk.belowCount)}
              </MenuItem>
              <fieldset className="m-0 border-0 p-0">
                <legend className="px-3 pt-1.5 text-caption text-muted">
                  {t('discover.thresholdPercentage')}
                </legend>
                <div className="flex flex-wrap gap-1 px-2 pb-1.5 pt-1">
                  {APPROVE_THRESHOLD_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="menuitemradio"
                      aria-checked={bulk.threshold === option}
                      tabIndex={-1}
                      onClick={() => bulk.onThresholdChange(option)}
                      className={cn(
                        'rounded-control px-2 py-1 text-caption tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                        bulk.threshold === option
                          ? 'bg-accent text-accent-fg'
                          : 'text-muted hover:bg-surface-2 hover:text-text',
                      )}
                    >
                      {option}%
                    </button>
                  ))}
                </div>
              </fieldset>
              <hr className="my-1 border-border" />
              <MenuItem disabled={bulk.auditionCount === 0} onSelect={() => run(bulk.onAudition)}>
                {withCount(t('discover.auditionAll'), bulk.auditionCount)}
              </MenuItem>
              <MenuItem onSelect={() => run(bulk.onToggleBulkMode)}>
                {bulk.bulkMode ? t('common.cancel') : t('discover.select')}
              </MenuItem>
              <hr className="my-1 border-border" />
            </>
          )}
          <fieldset className="m-0 border-0 p-0 md:hidden">
            <legend className="px-3 pt-1.5 text-caption text-muted">
              {t('discover.viewLabel')}
            </legend>
            {viewOptions.map(({ mode, label }) => (
              <MenuItem
                key={mode}
                role="menuitemradio"
                checked={viewMode === mode}
                onSelect={() => run(() => onViewModeChange(mode))}
              >
                {label}
              </MenuItem>
            ))}
            <hr className="my-1 border-border" />
          </fieldset>
          <MenuItem onSelect={() => run(onToggleInsights)}>
            {insightsOpen ? t('discover.hideFeedbackInsights') : t('discover.showFeedbackInsights')}
          </MenuItem>
          {onRefresh && (
            <MenuItem onSelect={() => run(onRefresh)}>
              <RefreshCw size={14} aria-hidden="true" />
              {t('discover.refreshData')}
            </MenuItem>
          )}
          {(['json', 'csv', 'm3u'] as const).map((format) => (
            <MenuItem
              key={format}
              disabled={exporting !== null}
              onSelect={() => handleExport(format)}
            >
              <Download size={14} aria-hidden="true" />
              {exporting === format
                ? t('discover.exporting')
                : `${t('discover.export')} ${format.toUpperCase()}`}
            </MenuItem>
          ))}
          {onClearAll && (
            <>
              <hr className="my-1 border-border" />
              <MenuItem tone="reject" onSelect={() => run(onClearAll)}>
                <Trash2 size={14} aria-hidden="true" />
                {t('discover.clearAll')}
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  )
}
