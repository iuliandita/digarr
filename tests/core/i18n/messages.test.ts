import { describe, expect, it } from 'vitest'
import { ARTIST_EXTERNAL_LINK_KEYS } from '@/core/artists/external-links'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/core/i18n/locales'
import { getMessages, getRawMessages } from '@/core/i18n/messages'
import { en } from '@/core/i18n/messages/en'
import { REJECTION_REASONS } from '@/core/recommendations/rejection-reasons'
import { formatDate, formatDateTime, formatShortDate, formatShortDateTime } from '@/web/lib/intl'

describe('message catalogs', () => {
  it('every raw locale catalog has every english key', () => {
    const englishKeys = Object.keys(en).sort()

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(getRawMessages(locale)).sort(), locale).toEqual(englishKeys)
    }
  })

  it('every locale has every english key', () => {
    const englishKeys = Object.keys(getMessages('en')).sort()

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(getMessages(locale)).sort()).toEqual(englishKeys)
    }
  })

  it('rejection-reason messages match the live reason registry', () => {
    const messageReasons = Object.keys(en)
      .filter((key) => key.startsWith('rejectionReason.'))
      .map((key) => key.slice('rejectionReason.'.length))
      .sort()

    expect(messageReasons).toEqual([...REJECTION_REASONS].sort())
  })

  it('artist external-link messages match the live link registry', () => {
    const messageLinks = Object.keys(en)
      .filter((key) => key.startsWith('artist.externalLinks.'))
      .map((key) => key.slice('artist.externalLinks.'.length))
      .sort()

    expect(messageLinks).toEqual([...ARTIST_EXTERNAL_LINK_KEYS].sort())
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
