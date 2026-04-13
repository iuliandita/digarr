import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '@/core/i18n/locales'
import { getMessages } from '@/core/i18n/messages'
import type { MessageCatalog } from '@/core/i18n/messages/types'

export function parseAcceptLanguage(input?: string | null): SupportedLocale | null {
  const value = input?.trim()
  if (!value) return null

  const candidates = value
    .split(',')
    .map((entry) => {
      const [rawLocale, ...params] = entry.trim().split(';')
      const qValue = params.find((param) => param.trim().startsWith('q='))
      const q = qValue ? Number.parseFloat(qValue.split('=')[1] ?? '') : 1

      return {
        locale: normalizeLocale(rawLocale),
        quality: Number.isFinite(q) ? q : 0,
      }
    })
    .filter((candidate): candidate is { locale: SupportedLocale; quality: number } => {
      return candidate.locale !== null && candidate.quality > 0
    })
    .sort((a, b) => b.quality - a.quality)

  return candidates[0]?.locale ?? null
}

export function resolveRequestLocale(input: {
  userPreferredLocale?: string | null
  requestLocale?: string | null
  acceptLanguage?: string | null
}): SupportedLocale {
  return (
    normalizeLocale(input.requestLocale) ??
    normalizeLocale(input.userPreferredLocale) ??
    parseAcceptLanguage(input.acceptLanguage) ??
    DEFAULT_LOCALE
  )
}

export function resolveRequestMessages(input: {
  userPreferredLocale?: string | null
  requestLocale?: string | null
  acceptLanguage?: string | null
}): MessageCatalog {
  return getMessages(resolveRequestLocale(input))
}
