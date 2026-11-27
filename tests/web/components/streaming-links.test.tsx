// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ContextType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('StreamingLinks while the applePreviews preference is unknown', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('offers neither inline player, even with dashboard autoload on', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const preview = { stop: vi.fn(), applePreviews: 'unknown' } as unknown as NonNullable<
      ContextType<typeof PreviewContext>
    >
    const { container } = render(
      <I18nProvider>
        <PreviewContext.Provider value={preview}>
          <StreamingLinks
            streamingUrls={{ ...urls, appleMusic: 'https://music.apple.com/gb/artist/x/657515' }}
            artistName="Radiohead"
            spotifyAutoload={{ enabled: true, onChange: vi.fn() }}
          />
        </PreviewContext.Provider>
      </I18nProvider>,
    )
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load Spotify player' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load Apple Music player' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    // The service links themselves stay.
    expect(screen.getByTitle('Spotify')).toBeTruthy()
  })
})

describe('StreamingLinks with the applePreviews preference', () => {
  const urls = {
    spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb',
    appleMusic: 'https://music.apple.com/gb/artist/radiohead/657515',
  }
  const song = { trackId: 1097862062, artistName: 'Radiohead' }

  // Digarr's /api/v1/preview/apple answer: the songs, or a reason when there are none.
  function renderApple(
    songs: unknown[],
    props: Partial<Parameters<typeof StreamingLinks>[0]> = {},
  ) {
    const body = songs.length > 0 ? { songs } : { songs: null, reason: 'no-match' }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
    vi.stubGlobal('fetch', fetchMock)
    const stop = vi.fn()
    const preview = { stop, applePreviews: 'on' } as unknown as NonNullable<
      ContextType<typeof PreviewContext>
    >
    const view = render(
      <I18nProvider>
        <PreviewContext.Provider value={preview}>
          <StreamingLinks streamingUrls={urls} artistName="Radiohead" {...props} />
        </PreviewContext.Provider>
      </I18nProvider>,
    )
    return { fetchMock, stop, ...view }
  }

  afterEach(() => vi.unstubAllGlobals())

  it('offers the Apple player instead of the Spotify one and requests nothing until clicked', async () => {
    const { fetchMock, stop, container } = renderApple([song])
    expect(screen.queryByRole('button', { name: 'Load Spotify player' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Load Apple Music player' }))
    expect(stop).toHaveBeenCalledOnce()
    const frame = await screen.findByTitle('Apple Music preview')
    expect(frame.getAttribute('src')).toBe('https://embed.music.apple.com/song/1097862062')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/preview/apple?name=Radiohead&id=657515')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    })
    expect(container.querySelector('iframe[src*="spotify"]')).toBeNull()
  })

  it('offers the top three songs and swaps the player to the one clicked', async () => {
    const songs = [1, 2, 3, 4].map((n) => ({ ...song, trackId: n, trackName: `Song ${n}` }))
    renderApple(songs)
    fireEvent.click(screen.getByRole('button', { name: 'Load Apple Music player' }))
    const frame = () => screen.getByTitle('Apple Music preview').getAttribute('src')
    await screen.findByTitle('Apple Music preview')
    expect(frame()).toBe('https://embed.music.apple.com/song/1')
    expect(screen.getByRole('button', { name: 'Song 1' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Song 4' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Song 3' }))
    expect(frame()).toBe('https://embed.music.apple.com/song/3')
    expect(screen.getByRole('button', { name: 'Song 3' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says so when Apple has no song for the artist', async () => {
    const { container } = renderApple([])
    fireEvent.click(screen.getByRole('button', { name: 'Load Apple Music player' }))
    expect(await screen.findByText('No preview available for this artist')).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('loads without a click when Apple dashboard autoload is on, and can turn it off', async () => {
    const onChange = vi.fn()
    const spotifyChange = vi.fn()
    renderApple([song], {
      appleAutoload: { enabled: true, onChange },
      spotifyAutoload: { enabled: false, onChange: spotifyChange },
    })
    expect(await screen.findByTitle('Apple Music preview')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: "Don't load the Apple Music player automatically" }),
    )
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(spotifyChange).not.toHaveBeenCalled()
  })

  it('ignores Spotify autoload consent: stays click-to-load and requests nothing', () => {
    const spotifyChange = vi.fn()
    const { fetchMock, container } = renderApple([song], {
      spotifyAutoload: { enabled: true, onChange: spotifyChange },
      appleAutoload: { enabled: false, onChange: vi.fn() },
    })
    expect(screen.getByRole('button', { name: 'Load Apple Music player' })).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Load automatically on the dashboard')).toBeNull()
    expect(screen.queryByRole('button', { name: "Don't load automatically" })).toBeNull()
  })

  it('ticking the Apple autoload box saves only the Apple preference', async () => {
    const appleChange = vi.fn()
    const spotifyChange = vi.fn()
    renderApple([song], {
      spotifyAutoload: { enabled: false, onChange: spotifyChange },
      appleAutoload: { enabled: false, onChange: appleChange },
    })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Load the Apple Music player automatically on the dashboard',
      }),
    )
    expect(appleChange).toHaveBeenCalledExactlyOnceWith(true)
    expect(spotifyChange).not.toHaveBeenCalled()
    expect(await screen.findByTitle('Apple Music preview')).toBeTruthy()
  })

  it('shows no inline player in compact mode', () => {
    const { fetchMock } = renderApple([song], { compact: true })
    expect(screen.queryByRole('button', { name: 'Load Apple Music player' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
