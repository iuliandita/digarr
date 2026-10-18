// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { de } from '@/core/i18n/messages/de'
import { en } from '@/core/i18n/messages/en'
import { fr } from '@/core/i18n/messages/fr'
import type { MessageCatalog } from '@/core/i18n/messages/types'
import { I18nProvider, useI18n } from '@/web/lib/i18n'
import { installMemoryLocalStorage } from '../helpers/storage'

const catalogs = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('@/web/lib/locale-catalogs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/lib/locale-catalogs')>()
  return {
    getLoadedMessages: (locale: string) =>
      locale === 'en' ? actual.getLoadedMessages('en') : undefined,
    loadMessages: catalogs.load,
  }
})

function deferred() {
  let resolve!: (value: MessageCatalog) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<MessageCatalog>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function Probe() {
  const { locale, pendingLocale, setLocale, t } = useI18n()

  return (
    <>
      <span data-testid="locale">{locale}</span>
      <span data-testid="pending">{pendingLocale ?? ''}</span>
      <span data-testid="text">{t('auth.signIn')}</span>
      <button type="button" onClick={() => setLocale('de')}>
        switch
      </button>
    </>
  )
}

function renderProbe() {
  return render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  )
}

describe('I18nProvider', () => {
  beforeEach(() => {
    catalogs.load.mockReset()
    document.documentElement.lang = 'en'
    document.documentElement.dir = ''
    installMemoryLocalStorage()
    Object.defineProperty(window.navigator, 'languages', { configurable: true, value: ['de-DE'] })
  })

  it('holds rendering until the stored locale catalog loads, preferring it over the browser locale', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    const load = deferred()
    catalogs.load.mockReturnValue(load.promise)

    const { container } = renderProbe()

    expect(catalogs.load).toHaveBeenCalledWith('fr')
    expect(container).toBeEmptyDOMElement()

    await act(async () => load.resolve({ ...en, ...fr }))

    expect(screen.getByTestId('locale')).toHaveTextContent('fr')
    expect(screen.getByTestId('text')).toHaveTextContent(fr['auth.signIn'])
    expect(document.documentElement.lang).toBe('fr')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('keeps the current language during a switch until the new catalog arrives', async () => {
    localStorage.setItem('digarr-locale', 'en')
    const load = deferred()
    catalogs.load.mockReturnValue(load.promise)
    renderProbe()

    fireEvent.click(screen.getByRole('button', { name: 'switch' }))

    expect(localStorage.getItem('digarr-locale')).toBe('de')
    expect(screen.getByTestId('pending')).toHaveTextContent('de')
    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    expect(screen.getByTestId('text')).toHaveTextContent(en['auth.signIn'])

    await act(async () => load.resolve({ ...en, ...de }))

    expect(screen.getByTestId('locale')).toHaveTextContent('de')
    expect(screen.getByTestId('text')).toHaveTextContent(de['auth.signIn'])
  })

  it('falls back to English when the stored locale catalog fails to load', async () => {
    localStorage.setItem('digarr-locale', 'fr')
    const load = deferred()
    catalogs.load.mockReturnValue(load.promise)
    renderProbe()

    await act(async () => load.reject(new Error('chunk failed')))

    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    expect(screen.getByTestId('text')).toHaveTextContent(en['auth.signIn'])
    expect(catalogs.load).toHaveBeenCalledTimes(1)
  })
})

describe('locale catalog loader', () => {
  it('loads a locale once and caches it merged over English', async () => {
    const loader = await vi.importActual<typeof import('@/web/lib/locale-catalogs')>(
      '@/web/lib/locale-catalogs',
    )

    expect(loader.getLoadedMessages('fr')).toBeUndefined()

    const [first, second] = await Promise.all([
      loader.loadMessages('fr'),
      loader.loadMessages('fr'),
    ])

    expect(first).toBe(second)
    expect(loader.getLoadedMessages('fr')).toBe(first)
    expect(first['auth.signIn']).toBe(fr['auth.signIn'])
    expect(Object.keys(first)).toEqual(expect.arrayContaining(Object.keys(en)))
  })
})
