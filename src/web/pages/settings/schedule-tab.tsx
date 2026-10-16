import { useState } from 'react'
import { toast } from 'sonner'
import { Field } from '../../components/field'
import { Hint } from '../../components/hint'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { updateSettings } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import type { Settings } from './types'

type CronPreset = { label: string; value: string }

const PRESETS: CronPreset[] = [
  { label: 'Daily', value: '0 0 * * *' },
  { label: 'Weekly', value: '0 0 * * 0' },
  { label: 'Biweekly', value: '0 0 1,15 * *' },
  { label: 'Monthly', value: '0 0 1 * *' },
]

export function ScheduleTab({ settings }: { settings: Settings }) {
  const { t } = useI18n()
  const prefs = settings.preferences ?? {}
  const [cron, setCron] = useState(prefs.scheduleCron ?? '0 0 * * *')
  const [librarySyncIntervalHours, setLibrarySyncIntervalHours] = useState(
    String(settings.librarySyncIntervalHours ?? 6),
  )
  const [saving, setSaving] = useState(false)

  const presetLabels: Record<string, string> = {
    Daily: t('settings.daily'),
    Weekly: t('settings.weekly'),
    Biweekly: t('settings.biweekly'),
    Monthly: t('settings.monthly'),
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateSettings({
        preferences: { ...prefs, scheduleCron: cron },
        librarySyncIntervalHours: Number.parseInt(librarySyncIntervalHours, 10) || 6,
      })
      toast.success(t('settings.scheduleSaved'))
    } catch {
      toast.error(t('settings.scheduleFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Hint id="settings-schedule-tip" type="inline">
        {t('settings.scheduleTip')}
      </Hint>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.presets')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              variant={cron === p.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCron(p.value)}
            >
              {presetLabels[p.label] ?? p.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.customCron')}
        </h2>
        <Field label={t('settings.cronExpression')} id="cron-expr">
          <Input
            id="cron-expr"
            placeholder="0 0 * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="font-mono"
          />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
          {t('settings.librarySyncInterval')}
        </h2>
        <Field label={t('settings.librarySyncIntervalHours')} id="library-sync-interval-hours">
          <Input
            id="library-sync-interval-hours"
            type="number"
            min="1"
            max="24"
            value={librarySyncIntervalHours}
            onChange={(e) => setLibrarySyncIntervalHours(e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted">{t('settings.librarySyncIntervalHelp')}</p>
      </section>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? t('settings.saving') : t('settings.save')}
      </Button>
    </div>
  )
}
