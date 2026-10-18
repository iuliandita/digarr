import { Cron } from 'croner'
import { useState } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
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

export function describeCron(t: (key: MessageKey) => string, cron: string): string {
  const preset = PRESETS.find((p) => p.cron === cron.trim())
  return preset ? t(preset.labelKey) : cron
}

export function CronPicker({ value, onChange }: CronPickerProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'preset' | 'custom'>(
    PRESETS.some((p) => p.cron === value) ? 'preset' : 'custom',
  )

  let valid = false
  try {
    new Cron(value, { maxRuns: 0 })
    valid = true
  } catch {
    // Match the scheduler's cron parser before submitting.
  }

  return (
    <div className="space-y-2">
      <select
        aria-label={t('common.schedule')}
        value={mode === 'custom' ? 'custom' : value}
        onChange={(e) => {
          if (e.target.value === 'custom') setMode('custom')
          else {
            setMode('preset')
            onChange(e.target.value)
          }
        }}
        className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text"
      >
        {PRESETS.map((preset) => (
          <option key={preset.cron} value={preset.cron}>
            {t(preset.labelKey)}
          </option>
        ))}
        <option value="custom">{t('common.custom')}</option>
      </select>
      {mode === 'custom' && (
        <div className="space-y-1">
          <input
            aria-label={t('common.custom')}
            required
            aria-invalid={!valid}
            ref={(input) => input?.setCustomValidity(valid ? '' : t('cronPicker.invalid'))}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 8 * * 1"
            className="w-full px-3 py-2 bg-surface border border-border rounded text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <p className="text-xs text-muted">{t('cronPicker.standardHint')}</p>
          {!valid && (
            <p role="alert" className="text-xs text-reject">
              {t('cronPicker.invalid')}
            </p>
          )}
        </div>
      )}

      <div className="text-xs text-muted">
        {t('common.current')}:{' '}
        <code className="bg-surface px-1 py-0.5 rounded">{value || t('common.none')}</code>
      </div>
    </div>
  )
}
