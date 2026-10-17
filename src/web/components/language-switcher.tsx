import { Check, Globe } from 'lucide-react'
import {
  getLocaleLabel,
  resolveSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@/core/i18n/locales'
import { useMenu } from '@/web/hooks/use-menu'
import { useI18n } from '@/web/lib/i18n'
import { cn } from '@/web/lib/utils'

/** Globe button that opens the language list, each language shown in its own name. */
export function LanguageSwitcher({
  value,
  onChange,
  placement = 'bottom-end',
  testId = 'language-switcher',
}: {
  value: SupportedLocale
  onChange: (value: SupportedLocale) => void
  placement?: 'bottom-end' | 'bottom-start' | 'top' | 'top-end'
  testId?: string
}) {
  const { t } = useI18n()
  const menu = useMenu()

  return (
    <div ref={menu.containerRef} className="relative">
      <button
        type="button"
        data-testid={testId}
        {...menu.triggerProps}
        aria-label={t('common.language')}
        title={getLocaleLabel(value)}
        className="flex h-11 w-11 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-text focus-ring md:h-9 md:w-9"
      >
        <Globe size={18} aria-hidden="true" />
      </button>
      {menu.open && (
        <div
          {...menu.menuProps}
          role="menu"
          aria-label={t('common.language')}
          className={cn(
            'absolute z-50 max-h-80 w-52 overflow-y-auto rounded-surface border border-border bg-surface py-1 shadow-menu',
            placement === 'top' && 'bottom-full left-1/2 mb-2 -translate-x-1/2',
            placement === 'top-end' && 'bottom-full right-0 mb-2',
            placement === 'bottom-end' && 'right-0 top-full mt-2',
            placement === 'bottom-start' && 'left-0 top-full mt-2',
          )}
        >
          {SUPPORTED_LOCALES.map((locale) => {
            const selected = locale === value
            return (
              <button
                key={locale}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                lang={locale}
                tabIndex={-1}
                onClick={() => {
                  onChange(locale)
                  menu.close(true)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-body transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  selected ? 'text-accent-text' : 'text-text',
                )}
              >
                {getLocaleLabel(locale)}
                {selected && <Check size={14} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Labelled select for forms, where the language is one preference among others. */
export function LanguageSelect({
  id,
  value,
  onChange,
}: {
  id?: string
  value: SupportedLocale
  onChange: (value: SupportedLocale) => void
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(resolveSupportedLocale(e.target.value))}
      className="min-h-11 rounded-control border border-border bg-surface px-2 py-1 text-body text-text focus-ring md:min-h-9"
    >
      {SUPPORTED_LOCALES.map((locale) => (
        <option key={locale} value={locale} lang={locale}>
          {getLocaleLabel(locale)}
        </option>
      ))}
    </select>
  )
}
