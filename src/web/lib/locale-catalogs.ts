import type { SupportedLocale } from '@/core/i18n/locales'
import { en } from '@/core/i18n/messages/en'
import type { MessageCatalog } from '@/core/i18n/messages/types'

type LazyLocale = Exclude<SupportedLocale, 'en'>

// One literal import() per locale so Vite emits a separate chunk for each.
const LOADERS: Record<LazyLocale, () => Promise<MessageCatalog>> = {
  es: () => import('@/core/i18n/messages/es').then((m) => m.es),
  fr: () => import('@/core/i18n/messages/fr').then((m) => m.fr),
  de: () => import('@/core/i18n/messages/de').then((m) => m.de),
  'pt-BR': () => import('@/core/i18n/messages/pt-BR').then((m) => m.ptBR),
  it: () => import('@/core/i18n/messages/it').then((m) => m.it),
  nl: () => import('@/core/i18n/messages/nl').then((m) => m.nl),
  ro: () => import('@/core/i18n/messages/ro').then((m) => m.ro),
  pl: () => import('@/core/i18n/messages/pl').then((m) => m.pl),
  tr: () => import('@/core/i18n/messages/tr').then((m) => m.tr),
  uk: () => import('@/core/i18n/messages/uk').then((m) => m.uk),
  ru: () => import('@/core/i18n/messages/ru').then((m) => m.ru),
  ja: () => import('@/core/i18n/messages/ja').then((m) => m.ja),
  ko: () => import('@/core/i18n/messages/ko').then((m) => m.ko),
  'zh-CN': () => import('@/core/i18n/messages/zh-CN').then((m) => m.zhCN),
}

const loaded = new Map<SupportedLocale, MessageCatalog>([['en', en]])
const inFlight = new Map<SupportedLocale, Promise<MessageCatalog>>()

export function getLoadedMessages(locale: SupportedLocale): MessageCatalog | undefined {
  return loaded.get(locale)
}

export function loadMessages(locale: SupportedLocale): Promise<MessageCatalog> {
  const cached = loaded.get(locale)
  if (cached) return Promise.resolve(cached)

  const pending = inFlight.get(locale)
  if (pending) return pending

  const promise = LOADERS[locale as LazyLocale]()
    .then((raw) => {
      const merged = { ...en, ...raw }
      loaded.set(locale, merged)
      return merged
    })
    .finally(() => {
      inFlight.delete(locale)
    })
  inFlight.set(locale, promise)
  return promise
}
