// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ContextType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StreamingLinks } from '@/web/components/streaming-links'
import { I18nProvider } from '@/web/lib/i18n'
import { PreviewContext } from '@/web/lib/preview-context'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

const urls = { spotify: 'https://open.spotify.com/artist/abc123' }

function renderLinks(stop = vi.fn()) {
  const preview = { stop } as unknown as NonNullable<ContextType<typeof PreviewContext>>
  render(
    <I18nProvider>
      <PreviewContext.Provider value={preview}>
        <StreamingLinks streamingUrls={urls} artistName="Radiohead" />
      </PreviewContext.Provider>
    </I18nProvider>,
  )
  return stop
}

describe('StreamingLinks Spotify embed', () => {
  it('renders no Spotify iframe or script until the load button is clicked', () => {
    const stop = renderLinks()
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('script[src*="spotify"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Load Spotify player' }))

    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe(
      'https://open.spotify.com/embed/artist/abc123?utm_source=generator',
    )
    expect(stop).toHaveBeenCalledOnce()
  })

  it('never embeds in compact mode', () => {
    render(
      <I18nProvider>
        <StreamingLinks streamingUrls={urls} artistName="Radiohead" compact />
      </I18nProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Load Spotify player' })).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('StreamingLinks Spotify autoload', () => {
  function renderAuto(enabled: boolean, dashboard = true) {
    const onChange = vi.fn()
    const stop = vi.fn()
    const preview = { stop } as unknown as NonNullable<ContextType<typeof PreviewContext>>
    render(
      <I18nProvider>
        <PreviewContext.Provider value={preview}>
          <StreamingLinks
            streamingUrls={urls}
            artistName="Radiohead"
            spotifyAutoload={dashboard ? { enabled, onChange } : undefined}
          />
        </PreviewContext.Provider>
      </I18nProvider>,
    )
    return { onChange, stop }
  }

  it('loads the player without a click when enabled, and never stops a preview', () => {
    const { onChange, stop } = renderAuto(true)
    expect(document.querySelector('iframe')).not.toBeNull()
    expect(stop).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: "Don't load automatically" }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('offers the checkbox without loading when disabled, and ticking saves and loads', () => {
    const { onChange } = renderAuto(false)
    expect(document.querySelector('iframe')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Load automatically on the dashboard' }))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(document.querySelector('iframe')).not.toBeNull()
  })

  it('stays click-to-load with no checkbox outside the dashboard', () => {
    renderAuto(true, false)
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
