// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PreviewPlayer } from '@/web/components/preview-player'
import type { PreviewSource } from '@/web/hooks/use-preview'
import { I18nProvider } from '@/web/lib/i18n'

const { mockUseSpotifyEmbed } = vi.hoisted(() => ({
  mockUseSpotifyEmbed: vi.fn(() => ({ hostRef: { current: null }, failed: false })),
}))

vi.mock('@/web/hooks/use-spotify-embed', () => ({
  useSpotifyEmbed: mockUseSpotifyEmbed,
}))

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

function withI18n(node: ReactNode) {
  return <I18nProvider>{node}</I18nProvider>
}

const spotifySource: PreviewSource = {
  type: 'spotify-embed',
  url: 'https://open.spotify.com/track/abc',
  embedUrl: 'https://open.spotify.com/embed/track/abc',
}

const spotify = {
  command: { id: 1, action: 'play' as const },
  onPlaybackStarted: vi.fn(),
  onPlaybackPaused: vi.fn(),
  onPlaybackEnded: vi.fn(),
  onPlaybackUnavailable: vi.fn(),
}

describe('PreviewPlayer', () => {
  it('renders nothing when not playing and not loading', () => {
    const { container } = render(
      withI18n(
        <PreviewPlayer
          playing={false}
          loading={false}
          artistName={null}
          source={null}
          onStop={vi.fn()}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
        />,
      ),
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the player region when loading', () => {
    render(
      withI18n(
        <PreviewPlayer
          playing={false}
          loading={true}
          artistName="Radiohead"
          source={null}
          onStop={vi.fn()}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
        />,
      ),
    )
    // The <section> has aria-label from the i18n key preview.playerRegion
    expect(screen.getByRole('region')).toBeInTheDocument()
  })

  it('shows artist name when playing', () => {
    render(
      withI18n(
        <PreviewPlayer
          playing={true}
          loading={false}
          artistName="Radiohead"
          source={spotifySource}
          onStop={vi.fn()}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
        />,
      ),
    )
    expect(screen.getByText('Radiohead')).toBeInTheDocument()
  })

  it('calls onStop when the close button is clicked', () => {
    const onStop = vi.fn()
    render(
      withI18n(
        <PreviewPlayer
          playing={true}
          loading={false}
          artistName="Radiohead"
          source={spotifySource}
          onStop={onStop}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
        />,
      ),
    )
    const stopButton = screen.getByRole('button')
    fireEvent.click(stopButton)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('renders no queue controls without a queue prop', () => {
    render(
      withI18n(
        <PreviewPlayer
          playing={true}
          loading={false}
          artistName="Radiohead"
          source={spotifySource}
          onStop={vi.fn()}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
        />,
      ),
    )
    expect(screen.queryByLabelText('Next preview')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Previous preview')).not.toBeInTheDocument()
  })

  it('renders the queue position and fires the queue callbacks', () => {
    const onNext = vi.fn()
    const onPrevious = vi.fn()
    render(
      withI18n(
        <PreviewPlayer
          playing={true}
          loading={false}
          artistName="Radiohead"
          source={spotifySource}
          onStop={vi.fn()}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
          queue={{ index: 1, count: 5, onNext, onPrevious }}
        />,
      ),
    )
    expect(screen.getByText('2 of 5')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Next preview'))
    expect(onNext).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByLabelText('Previous preview'))
    expect(onPrevious).toHaveBeenCalledTimes(1)
  })

  it('disables the previous button at the first item', () => {
    const onPrevious = vi.fn()
    render(
      withI18n(
        <PreviewPlayer
          playing={true}
          loading={false}
          artistName="Radiohead"
          source={spotifySource}
          onStop={vi.fn()}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
          queue={{ index: 0, count: 3, onNext: vi.fn(), onPrevious }}
        />,
      ),
    )
    const prev = screen.getByLabelText('Previous preview')
    expect(prev).toBeDisabled()
    fireEvent.click(prev)
    expect(onPrevious).not.toHaveBeenCalled()
  })

  it('keeps the persistent Spotify controller visible while autoplay waits for a user', () => {
    render(
      withI18n(
        <PreviewPlayer
          playing={false}
          loading={false}
          artistName="Radiohead"
          source={spotifySource}
          onStop={vi.fn()}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
          queue={{ index: 0, count: 3, onNext: vi.fn(), onPrevious: vi.fn() }}
        />,
      ),
    )

    expect(screen.getByRole('region')).toBeVisible()
    expect(mockUseSpotifyEmbed).toHaveBeenLastCalledWith({
      url: spotifySource.url,
      keepAlive: true,
      command: spotify.command,
      onPlaybackStarted: spotify.onPlaybackStarted,
      onPlaybackPaused: spotify.onPlaybackPaused,
      onPlaybackEnded: spotify.onPlaybackEnded,
    })
  })

  it('falls back to a usable Spotify iframe when controller initialization fails', () => {
    mockUseSpotifyEmbed.mockReturnValueOnce({ hostRef: { current: null }, failed: true })

    render(
      withI18n(
        <PreviewPlayer
          playing={false}
          loading={false}
          artistName="Radiohead"
          source={spotifySource}
          onStop={vi.fn()}
          spotify={spotify}
          volume={1}
          onVolumeChange={vi.fn()}
        />,
      ),
    )

    expect(screen.getByTitle('Radiohead')).toHaveAttribute('src', spotifySource.embedUrl)
  })

  it('reports a controller failure to an active queue instead of parking it', async () => {
    const onPlaybackUnavailable = vi.fn()
    mockUseSpotifyEmbed.mockReturnValue({ hostRef: { current: null }, failed: true })

    render(
      <StrictMode>
        {withI18n(
          <PreviewPlayer
            playing={false}
            loading={false}
            artistName="Radiohead"
            source={spotifySource}
            onStop={vi.fn()}
            spotify={{ ...spotify, onPlaybackUnavailable }}
            volume={1}
            onVolumeChange={vi.fn()}
            queue={{ index: 0, count: 3, onNext: vi.fn(), onPrevious: vi.fn() }}
          />,
        )}
      </StrictMode>,
    )

    await waitFor(() => expect(onPlaybackUnavailable).toHaveBeenCalledTimes(1))
    expect(screen.queryByTitle('Radiohead')).not.toBeInTheDocument()
    mockUseSpotifyEmbed.mockReturnValue({ hostRef: { current: null }, failed: false })
  })
})
