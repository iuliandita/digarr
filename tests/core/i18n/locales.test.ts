import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, normalizeLocale, resolveSupportedLocale } from '@/core/i18n/locales'

describe('locales', () => {
  it('normalizes aliases to supported locales', () => {
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('es-MX')).toBe('es')
    expect(normalizeLocale('pt')).toBe('pt-BR')
    expect(normalizeLocale('zh')).toBe('zh-CN')
  })

  it('falls back to the base language for regional inputs', () => {
    expect(normalizeLocale('fr-CA')).toBe('fr')
    expect(normalizeLocale('de-AT')).toBe('de')
    expect(normalizeLocale('it-CH')).toBe('it')
    expect(resolveSupportedLocale('pt-PT')).toBe('pt-BR')
  })

  it('preserves direct supported locale tags', () => {
    expect(normalizeLocale('pt-BR')).toBe('pt-BR')
    expect(resolveSupportedLocale('pt-BR')).toBe('pt-BR')
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty-x'])(
    'ignores inherited object keys: %s',
    (input) => {
      expect(normalizeLocale(input)).toBeNull()
    },
  )

  it('falls back to english for unsupported values', () => {
    expect(resolveSupportedLocale('xx-YY')).toBe(DEFAULT_LOCALE)
    expect(resolveSupportedLocale('')).toBe(DEFAULT_LOCALE)
  })
})
