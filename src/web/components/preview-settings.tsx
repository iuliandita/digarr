import { useApplePreviews } from '../hooks/use-apple-previews'
import { useI18n } from '../lib/i18n'

export function PreviewSettings() {
  const { t } = useI18n()
  const applePreviews = useApplePreviews()
  return (
    <section className="space-y-3">
      <h2 className="text-lead font-semibold text-text">{t('settings.previews')}</h2>
      <label className="flex items-start gap-2 text-sm text-text">
        <input
          type="checkbox"
          className="mt-1 accent-accent"
          checked={applePreviews.enabled}
          disabled={!applePreviews.ready || applePreviews.saving}
          onChange={(event) => applePreviews.setEnabled(event.target.checked)}
        />
        <span>{t('settings.applePreviews')}</span>
      </label>
      <p className="text-xs text-muted">{t('settings.applePreviewsHelp')}</p>
    </section>
  )
}
