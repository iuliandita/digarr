export const SUPPORTED_LOCALES = [
  'en',
  'es',
  'fr',
  'de',
  'pt-BR',
  'it',
  'nl',
  'ro',
  'pl',
  'tr',
  'uk',
  'ru',
  'ja',
  'ko',
  'zh-CN',
] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'en'

const LOCALE_ALIASES: Record<string, SupportedLocale> = {
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  es: 'es',
  'es-es': 'es',
  'es-mx': 'es',
  fr: 'fr',
  de: 'de',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  it: 'it',
  nl: 'nl',
  ro: 'ro',
  pl: 'pl',
  tr: 'tr',
  uk: 'uk',
  ru: 'ru',
  ja: 'ja',
  ko: 'ko',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
}

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
  it: 'Italiano',
  nl: 'Nederlands',
  ro: 'Română',
  pl: 'Polski',
  tr: 'Türkçe',
  uk: 'Українська',
  ru: 'Русский',
  ja: '日本語',
  ko: '한국어',
  'zh-CN': '中文',
}

export function normalizeLocale(input?: string | null): SupportedLocale | null {
  const value = input?.trim()
  if (!value) return null
  const normalized = value.toLowerCase()

  if (Object.hasOwn(LOCALE_ALIASES, normalized)) return LOCALE_ALIASES[normalized] ?? null

  const baseLanguage = normalized.split(/[-_]/, 1)[0] ?? normalized
  if (baseLanguage !== normalized && Object.hasOwn(LOCALE_ALIASES, baseLanguage)) {
    return LOCALE_ALIASES[baseLanguage] ?? null
  }

  return null
}

export function resolveSupportedLocale(input?: string | null): SupportedLocale {
  return normalizeLocale(input) ?? DEFAULT_LOCALE
}

export function getLocaleLabel(locale: SupportedLocale): string {
  return LOCALE_LABELS[locale]
}
