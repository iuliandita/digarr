import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/core/i18n/locales'
import { getMessages } from '@/core/i18n/messages'
import { de } from '@/core/i18n/messages/de'
import { en } from '@/core/i18n/messages/en'
import { es } from '@/core/i18n/messages/es'
import { fr } from '@/core/i18n/messages/fr'
import { it as itCatalog } from '@/core/i18n/messages/it'
import { ja } from '@/core/i18n/messages/ja'
import { ko } from '@/core/i18n/messages/ko'
import { nl } from '@/core/i18n/messages/nl'
import { pl } from '@/core/i18n/messages/pl'
import { ptBR } from '@/core/i18n/messages/pt-BR'
import { ro } from '@/core/i18n/messages/ro'
import { ru } from '@/core/i18n/messages/ru'
import { tr } from '@/core/i18n/messages/tr'
import type { MessageCatalog } from '@/core/i18n/messages/types'
import { uk } from '@/core/i18n/messages/uk'
import { zhCN } from '@/core/i18n/messages/zh-CN'
import { formatDate, formatDateTime, formatShortDate, formatShortDateTime } from '@/web/lib/intl'

const rawCatalogs: Record<SupportedLocale, Partial<MessageCatalog>> = {
  en,
  es,
  fr,
  de,
  'pt-BR': ptBR,
  it: itCatalog,
  nl,
  ro,
  pl,
  tr,
  uk,
  ru,
  ja,
  ko,
  'zh-CN': zhCN,
} as const

describe('message catalogs', () => {
  it('every locale catalog file only contains english keys', () => {
    const englishKeys = Object.keys(en).sort()

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(rawCatalogs[locale]).every((key) => englishKeys.includes(key))).toBe(true)
    }
  })

  it('every locale has every english key', () => {
    const englishKeys = Object.keys(getMessages('en')).sort()

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(getMessages(locale)).sort()).toEqual(englishKeys)
    }
  })
})

describe('intl helpers', () => {
  const locale: SupportedLocale = 'de'
  const value = '2026-04-11T13:45:00.000Z'

  it('formats short dates with the requested locale', () => {
    expect(formatShortDate(locale, value)).toBe(
      new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(value)),
    )
  })

  it('formats date times with the requested locale', () => {
    expect(formatDateTime(locale, value)).toBe(
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value)),
    )
  })

  it('formats short date times for month-day-time views', () => {
    expect(formatShortDateTime(locale, value)).toBe(
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value)),
    )
  })

  it('supports arbitrary Intl date formatting options', () => {
    expect(
      formatDate(locale, value, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    ).toBe(
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value)),
    )
  })
})
