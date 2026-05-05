import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { DEFAULT_LOCALE, type SupportedLocale } from '@/core/i18n/locales'
import { getMessages } from '@/core/i18n/messages'
import type { MessageKey } from '@/core/i18n/messages/types'
import { detectBrowserLocale, getStoredLocale, setStoredLocale } from './locale-storage'

type I18nValue = {
  locale: SupportedLocale
  pendingLocale: SupportedLocale | null
  setLocale: (locale: SupportedLocale) => void
  hydrateLocale: (locale: SupportedLocale | null) => void
  t: (key: MessageKey) => string
}

export const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    return getStoredLocale() ?? detectBrowserLocale()
  })
  const [pendingLocale, setPendingLocale] = useState<SupportedLocale | null>(null)

  const messages = getMessages(locale)

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = 'ltr'
  }, [locale])

  const setLocale = useCallback((nextLocale: SupportedLocale) => {
    setPendingLocale(nextLocale)
    setStoredLocale(nextLocale)
    setLocaleState(nextLocale)
  }, [])

  const hydrateLocale = useCallback(
    (nextLocale: SupportedLocale | null) => {
      if (!nextLocale) return
      if (pendingLocale && pendingLocale !== nextLocale) return

      if (pendingLocale === nextLocale) {
        setPendingLocale(null)
      }

      setStoredLocale(nextLocale)
      setLocaleState((currentLocale) => (currentLocale === nextLocale ? currentLocale : nextLocale))
    },
    [pendingLocale],
  )

  const value: I18nValue = useMemo(
    () => ({
      locale,
      pendingLocale,
      setLocale,
      hydrateLocale,
      t: (key) => messages[key] ?? getMessages(DEFAULT_LOCALE)[key] ?? key,
    }),
    [hydrateLocale, locale, messages, pendingLocale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) {
    throw new Error('useI18n must be used within I18nProvider')
  }

  return value
}
