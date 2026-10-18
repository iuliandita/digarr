import { type Mock, vi } from 'vitest'
import type { SupportedLocale } from '@/core/i18n/locales'

// Use inside a hoisted factory: vi.mock('@/web/lib/locale-storage', async () => (await import('../helpers/locale')).localeStorageMock())
// Preloads the catalog so I18nProvider renders on the first pass, as it does for a cached locale.
export async function localeStorageMock(
  locale: SupportedLocale = 'en',
): Promise<Record<string, Mock>> {
  const { loadMessages } = await import('@/web/lib/locale-catalogs')
  await loadMessages(locale)
  return {
    detectBrowserLocale: vi.fn(() => locale),
    getStoredLocale: vi.fn(() => locale),
    getRequestLocale: vi.fn(() => locale),
    setStoredLocale: vi.fn(),
  }
}
