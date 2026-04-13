import { useState } from 'react'
import { useI18n } from '../lib/i18n'

type CronPickerProps = {
  value: string
  onChange: (cron: string) => void
}

const PRESETS = [
  { labelKey: 'cronPicker.dailyMidnight', cron: '0 0 * * *' },
  { labelKey: 'common.everyMonday', cron: '0 8 * * 1' },
  { labelKey: 'common.everySunday', cron: '0 8 * * 0' },
  { labelKey: 'cronPicker.twiceAWeek', cron: '0 8 * * 1,4' },
  { labelKey: 'cronPicker.everyTwoWeeks', cron: '0 8 1,15 * *' },
  { labelKey: 'cronPicker.monthlyFirst', cron: '0 8 1 * *' },
] as const

export function CronPicker({ value, onChange }: CronPickerProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'preset' | 'custom'>(
    PRESETS.some((p) => p.cron === value) ? 'preset' : 'custom',
  )

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('preset')}
          className={`px-3 py-1 rounded text-sm ${
            mode === 'preset'
              ? 'bg-accent text-accent-fg'
              : 'bg-surface border border-border text-muted hover:text-text'
          }`}
        >
          {t('cronPicker.preset')}
        </button>
        <button
          type="button"
          onClick={() => setMode('custom')}
          className={`px-3 py-1 rounded text-sm ${
            mode === 'custom'
              ? 'bg-accent text-accent-fg'
              : 'bg-surface border border-border text-muted hover:text-text'
          }`}
        >
          {t('common.custom')}
        </button>
      </div>

      {mode === 'preset' ? (
        <div className="grid gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.cron}
              type="button"
              onClick={() => onChange(preset.cron)}
              className={`text-left px-3 py-2 rounded text-sm transition-colors ${
                value === preset.cron
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'bg-surface border border-border text-text hover:border-accent/40'
              }`}
            >
              <span className="font-medium">{t(preset.labelKey)}</span>
              <span className="text-muted text-xs ml-2">({preset.cron})</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 8 * * 1"
            className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <p className="text-xs text-muted">{t('cronPicker.standardHint')}</p>
        </div>
      )}

      <div className="text-xs text-muted">
        {t('common.current')}:{' '}
        <code className="bg-surface px-1 py-0.5 rounded">{value || t('common.none')}</code>
      </div>
    </div>
  )
}
