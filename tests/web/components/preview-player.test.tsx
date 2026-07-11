// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PreviewPlayer } from '@/web/components/preview-player'
import type { PreviewSource } from '@/web/hooks/use-preview'
import { I18nProvider } from '@/web/lib/i18n'

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
})
