// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlockedAlbumsTab } from '@/web/components/blocked-albums-tab'
import { listAlbumBlocks } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({ listAlbumBlocks: vi.fn(), deleteAlbumBlock: vi.fn() }))

const block = (id: number, albumTitle: string | null) => ({
  id,
  artistId: 1,
  artistName: 'Same Artist',
  artistMbid: null,
  releaseGroupMbid: `00000000-0000-0000-0000-00000000000${id}`,
  albumTitle,
  reason: null,
  reasonText: null,
  blockedAt: '2026-01-01T00:00:00Z',
})

describe('BlockedAlbumsTab', () => {
  it('shows the album title with the MBID as detail, and the MBID alone for legacy rows', async () => {
    vi.mocked(listAlbumBlocks).mockResolvedValue({
      items: [block(1, 'First Album'), block(2, null)],
    })
    render(
      <I18nProvider>
        <BlockedAlbumsTab />
      </I18nProvider>,
    )

    expect(await screen.findByText('First Album')).toBeInTheDocument()
    expect(screen.getByText('00000000-0000-0000-0000-000000000001')).toBeInTheDocument()
    expect(screen.getByText('00000000-0000-0000-0000-000000000002')).toHaveClass('font-medium')
    expect(screen.getAllByText('Same Artist')).toHaveLength(2)
  })
})
