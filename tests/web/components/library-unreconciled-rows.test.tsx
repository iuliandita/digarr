// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryUnreconciledAlbumRowComponent } from '@/web/components/library-unreconciled-album-row'
import { LibraryUnreconciledRowComponent } from '@/web/components/library-unreconciled-row'
import type { LibraryUnreconciledAlbumRow, LibraryUnreconciledRow } from '@/web/lib/api'
import { saveLibraryOverride } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

const mockSaveLibraryOverride = vi.mocked(saveLibraryOverride)

vi.mock('@/web/lib/api', () => ({
  rerunLibraryReconciler: vi.fn(),
  saveLibraryAlbumOverride: vi.fn(),
  saveLibraryOverride: vi.fn(),
}))

const artistRow: LibraryUnreconciledRow = {
  id: 1,
  source: 'plex',
  sourceArtistId: 'artist-1',
  name: 'Artist Name',
  unreconciledReason: 'ambiguous',
}

const albumRow: LibraryUnreconciledAlbumRow = {
  id: 2,
  source: 'plex',
  sourceAlbumId: 'album-1',
  title: 'Album Title',
  primaryType: 'Album',
  releaseYear: 2001,
  unreconciledReason: 'ambiguous',
}

function renderArtist(
  overrides: Partial<{
    row: LibraryUnreconciledRow
    selected: boolean
    selectionDisabled: boolean
    bulkBusy: boolean
    onSelectionChange: (selected: boolean) => void
  }> = {},
) {
  return render(
    <I18nProvider>
      <LibraryUnreconciledRowComponent
        row={artistRow}
        selected={true}
        selectionDisabled={false}
        bulkBusy={false}
        onResolved={vi.fn()}
        onSelectionChange={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  )
}

function renderAlbum(
  overrides: Partial<{
    row: LibraryUnreconciledAlbumRow
    selected: boolean
    selectionDisabled: boolean
    bulkBusy: boolean
    onSelectionChange: (selected: boolean) => void
  }> = {},
) {
  return render(
    <I18nProvider>
      <LibraryUnreconciledAlbumRowComponent
        row={albumRow}
        selected={true}
        selectionDisabled={false}
        bulkBusy={false}
        onResolved={vi.fn()}
        onSelectionChange={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  )
}

describe('library unreconciled rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    })
  })

  it('keeps artist controls in a named group and reports selection changes', () => {
    const onSelectionChange = vi.fn()
    renderArtist({ onSelectionChange })

    const group = screen.getByRole('group', { name: artistRow.name })
    const checkbox = within(group).getByRole('checkbox', { name: 'Select artist Artist Name' })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(onSelectionChange).toHaveBeenCalledWith(false)
    expect(within(group).getByRole('button', { name: 'Pin' })).toBeEnabled()
    expect(within(group).getByRole('button', { name: 'Ignore forever' })).toBeEnabled()
    expect(within(group).getByPlaceholderText('Paste MBID (UUID)')).toBeInTheDocument()
  })

  it('disables the artist selection target when requested', () => {
    renderArtist({ selectionDisabled: true })

    const checkbox = screen.getByRole('checkbox', { name: 'Select artist Artist Name' })
    expect(checkbox).toBeDisabled()
    expect(checkbox.closest('label')).toHaveClass('cursor-not-allowed')
  })

  it('preserves dollar replacement tokens in artist labels and shows no normalized-name debug text', () => {
    renderArtist({
      row: {
        ...artistRow,
        name: 'Cash $& $$',
      },
    })

    expect(screen.getByRole('checkbox', { name: 'Select artist Cash $& $$' })).toBeInTheDocument()
    expect(screen.getByText('plex')).toBeInTheDocument()
    expect(screen.queryByText(/Normalized/)).not.toBeInTheDocument()
  })

  it('defensively excludes lookup-failed artists while keeping their actions available', () => {
    renderArtist({ row: { ...artistRow, unreconciledReason: 'lookup_failed' } })

    const group = screen.getByRole('group', { name: artistRow.name })
    expect(within(group).getByRole('checkbox')).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Pin' })).toBeEnabled()
    expect(within(group).getByRole('button', { name: 'Ignore forever' })).toBeEnabled()
  })

  it('locks artist checkbox and row actions during bulk work', () => {
    renderArtist({ bulkBusy: true })

    const group = screen.getByRole('group', { name: artistRow.name })
    expect(within(group).getByRole('checkbox')).toBeDisabled()
    expect(within(group).getByPlaceholderText('Paste MBID (UUID)')).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Pin' })).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Ignore forever' })).toBeDisabled()
  })

  it('deselects an artist before its pending row write locks controls', async () => {
    let resolve: () => void = () => undefined
    mockSaveLibraryOverride.mockReturnValueOnce(new Promise<void>((done) => (resolve = done)))
    const onSelectionChange = vi.fn()
    renderArtist({ onSelectionChange })

    fireEvent.click(screen.getByRole('button', { name: 'Ignore forever' }))
    expect(onSelectionChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ignore forever' })).toBeDisabled()
    resolve()
  })

  it('keeps album controls in a named group and reports selection changes', () => {
    const onSelectionChange = vi.fn()
    renderAlbum({ onSelectionChange })

    const group = screen.getByRole('group', { name: albumRow.title })
    const checkbox = within(group).getByRole('checkbox', { name: 'Select album Album Title' })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(onSelectionChange).toHaveBeenCalledWith(false)
    expect(within(group).getByRole('button', { name: 'Pin' })).toBeEnabled()
    expect(within(group).getByRole('button', { name: 'Ignore forever' })).toBeEnabled()
    expect(within(group).getByPlaceholderText('Paste album MBID (UUID)')).toBeInTheDocument()
  })

  it('disables album selection when requested or lookup fails', () => {
    const { rerender } = renderAlbum({ selectionDisabled: true })
    const explicitCheckbox = screen.getByRole('checkbox', { name: 'Select album Album Title' })
    expect(explicitCheckbox).toBeDisabled()
    expect(explicitCheckbox.closest('label')).toHaveClass('cursor-not-allowed')

    rerender(
      <I18nProvider>
        <LibraryUnreconciledAlbumRowComponent
          row={{ ...albumRow, unreconciledReason: 'lookup_failed' }}
          selected={true}
          selectionDisabled={false}
          bulkBusy={false}
          onResolved={vi.fn()}
          onSelectionChange={vi.fn()}
        />
      </I18nProvider>,
    )

    const group = screen.getByRole('group', { name: albumRow.title })
    expect(within(group).getByRole('checkbox')).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Pin' })).toBeEnabled()
    expect(within(group).getByRole('button', { name: 'Ignore forever' })).toBeEnabled()
  })

  it('preserves dollar replacement tokens in album labels', () => {
    renderAlbum({ row: { ...albumRow, title: 'Money $& $$' } })

    expect(screen.getByRole('checkbox', { name: 'Select album Money $& $$' })).toBeInTheDocument()
  })

  it('locks album checkbox and row actions during bulk work', () => {
    renderAlbum({ bulkBusy: true })

    const group = screen.getByRole('group', { name: albumRow.title })
    expect(within(group).getByRole('checkbox')).toBeDisabled()
    expect(within(group).getByPlaceholderText('Paste album MBID (UUID)')).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Pin' })).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Ignore forever' })).toBeDisabled()
  })
})
