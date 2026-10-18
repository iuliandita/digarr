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
import { en } from '@/core/i18n/messages/en'
import type { MessageCatalog, MessageKey } from '@/core/i18n/messages/types'
import { getLoadedMessages, loadMessages } from './locale-catalogs'
import { detectBrowserLocale, getStoredLocale, setStoredLocale } from './locale-storage'

type I18nValue = {
  locale: SupportedLocale
  pendingLocale: SupportedLocale | null
  setLocale: (locale: SupportedLocale) => void
  hydrateLocale: (locale: SupportedLocale | null) => void
  t: (key: MessageKey) => string
}

type ActiveCatalog = { locale: SupportedLocale; messages: MessageCatalog }

export const I18nContext = createContext<I18nValue | null>(null)

function loadedCatalog(locale: SupportedLocale): ActiveCatalog | null {
  const messages = getLoadedMessages(locale)
  return messages ? { locale, messages } : null
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [requestedLocale, setRequestedLocale] = useState<SupportedLocale>(() => {
    return getStoredLocale() ?? detectBrowserLocale()
  })
  const [pendingLocale, setPendingLocale] = useState<SupportedLocale | null>(null)
  // A requested locale becomes active only once its catalog has loaded, so a
  // switch keeps the current language on screen instead of flashing English.
  const [active, setActive] = useState<ActiveCatalog | null>(() => loadedCatalog(requestedLocale))
  const [failedLocale, setFailedLocale] = useState<SupportedLocale | null>(null)

  useEffect(() => {
    if (active?.locale === requestedLocale || failedLocale === requestedLocale) return

    let cancelled = false
    loadMessages(requestedLocale).then(
      (messages) => {
        if (!cancelled) setActive({ locale: requestedLocale, messages })
      },
      () => {
        if (cancelled) return
        setFailedLocale(requestedLocale)
        setActive((current) => current ?? { locale: DEFAULT_LOCALE, messages: en })
      },
    )
    return () => {
      cancelled = true
    }
  }, [active?.locale, failedLocale, requestedLocale])

  const locale = active?.locale ?? DEFAULT_LOCALE
  const messages = active?.messages ?? en

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = 'ltr'
  }, [locale])

  const setLocale = useCallback((nextLocale: SupportedLocale) => {
    setPendingLocale(nextLocale)
    setStoredLocale(nextLocale)
    setRequestedLocale(nextLocale)
  }, [])

  const hydrateLocale = useCallback(
    (nextLocale: SupportedLocale | null) => {
      if (!nextLocale) return
      if (pendingLocale && pendingLocale !== nextLocale) return

      if (pendingLocale === nextLocale) {
        setPendingLocale(null)
      }

      setStoredLocale(nextLocale)
      setRequestedLocale(nextLocale)
    },
    [pendingLocale],
  )

  const value: I18nValue = useMemo(
    () => ({
      locale,
      pendingLocale,
      setLocale,
      hydrateLocale,
      t: (key) => messages[key] ?? en[key] ?? key,
    }),
    [hydrateLocale, locale, messages, pendingLocale, setLocale],
  )

  if (!active) return null

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) {
    throw new Error('useI18n must be used within I18nProvider')
  }

  return value
}
