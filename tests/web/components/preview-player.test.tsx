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
})
