import {
  getLocaleLabel,
  resolveSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@/core/i18n/locales'
import { useI18n } from '@/web/lib/i18n'

export function LanguageSwitcher({
  value,
  onChange,
}: {
  value: SupportedLocale
  onChange: (value: SupportedLocale) => void
}) {
  const { t } = useI18n()

  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span>{t('common.language')}</span>
      <select
        data-testid="language-switcher"
        aria-label={t('common.language')}
        value={value}
        onChange={(e) => onChange(resolveSupportedLocale(e.target.value))}
        className="min-h-11 rounded-md border border-border bg-surface px-2 py-1 text-text focus:outline-none focus:ring-1 focus:ring-accent sm:min-h-9"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {getLocaleLabel(locale)}
          </option>
        ))}
      </select>
    </label>
  )
}
