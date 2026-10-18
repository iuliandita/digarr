import { type Mock, vi } from 'vitest'

// Use inside a hoisted factory: vi.mock('@/web/lib/locale-storage', async () => (await import('../helpers/locale')).localeStorageMock())
export function localeStorageMock(locale = 'en'): Record<string, Mock> {
  return {
    detectBrowserLocale: vi.fn(() => locale),
    getStoredLocale: vi.fn(() => locale),
    getRequestLocale: vi.fn(() => locale),
    setStoredLocale: vi.fn(),
  }
}
