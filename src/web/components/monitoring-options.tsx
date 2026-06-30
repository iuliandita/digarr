import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { Button } from './ui/button'

export type MonitorOption = 'all' | 'new' | 'selected' | 'popular' | 'none'

type Props = {
  onApprove: (option: MonitorOption, selectedAlbumIds?: string[]) => void
  onOpenAlbumPicker: () => void
  loading?: boolean
  fill?: boolean
  /** When false, the "Popular albums" option is disabled (no Spotify/Last.fm source). */
  popularAvailable?: boolean
}

export function MonitoringOptions({
  onApprove,
  onOpenAlbumPicker,
  loading,
  fill,
  popularAvailable = true,
}: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const options: Array<{
    value: MonitorOption
    label: string
    description: string
    disabled?: boolean
  }> = [
    {
      value: 'all',
      label: t('settings.monitorAll'),
      description: t('discover.monitorAllDescription'),
    },
    {
      value: 'new',
      label: t('settings.monitorNew'),
      description: t('discover.monitorNewDescription'),
    },
    {
      value: 'selected',
      label: t('discover.monitorSelected'),
      description: t('discover.monitorSelectedDescription'),
    },
    {
      value: 'popular',
      label: t('discover.monitorPopular'),
      description: popularAvailable
        ? t('discover.monitorPopularDescription')
        : t('discover.monitorPopularUnavailable'),
      disabled: !popularAvailable,
    },
    {
      value: 'none',
      label: t('common.none'),
      description: t('discover.monitorNoneDescription'),
    },
  ]

  function handleOptionClick(option: MonitorOption) {
    setOpen(false)
    if (option === 'selected') {
      onOpenAlbumPicker()
    } else {
      onApprove(option)
    }
  }

  return (
    <div className={`relative inline-flex ${fill ? 'w-full' : ''}`}>
      {/* Primary approve button - defaults to 'all' */}
      <Button
        size="sm"
        variant="outline"
        className={`rounded-r-none text-approve border-approve/40 hover:bg-approve/10 hover:text-approve border-r-0 ${fill ? 'flex-1 py-2 text-sm' : ''}`}
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation()
          onApprove('all')
        }}
      >
        {t('recommendation.approve')}
      </Button>
      {/* Dropdown toggle */}
      <button
        type="button"
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className={`inline-flex items-center justify-center px-1.5 py-1.5 rounded-r-md text-xs border border-approve/40 text-approve hover:bg-approve/10 transition-colors disabled:pointer-events-none disabled:opacity-50 ${fill ? 'px-2 py-2' : ''}`}
        aria-label={t('discover.monitoringOptions')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3 h-3"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <>
          {/* Click-away overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[200px]">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                title={opt.disabled ? opt.description : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  if (opt.disabled) return
                  handleOptionClick(opt.value)
                }}
                className="w-full text-left px-3 py-2 transition-colors enabled:hover:bg-bg/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-sm text-text font-medium">{opt.label}</div>
                <div className="text-xs text-muted mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
