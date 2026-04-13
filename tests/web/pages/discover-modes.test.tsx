// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'
import { PreviewContext } from '@/web/lib/preview-context'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getRequestLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

const noopPreview = {
  play: vi.fn(),
  stop: vi.fn(),
  hasPreview: () => false,
  currentMbid: null,
  playing: false,
  globalPlayId: 0,
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <I18nProvider>
        <QueryClientProvider client={client}>
          <PreviewContext.Provider value={noopPreview}>{ui}</PreviewContext.Provider>
        </QueryClientProvider>
      </I18nProvider>
    </MemoryRouter>,
  )
}

vi.mock('@/web/lib/api', () => ({
  getDiscoveryModes: vi.fn(),
  runDiscoveryMode: vi.fn(),
}))

import { getDiscoveryModes, runDiscoveryMode } from '@/web/lib/api'
import { DiscoveryModesPage } from '@/web/pages/discovery-modes'

const mockGetDiscoveryModes = vi.mocked(getDiscoveryModes)
const mockRunDiscoveryMode = vi.mocked(runDiscoveryMode)

describe('DiscoveryModesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver
  })

  it('renders the dedicated discovery modes page and submits the release radar payload', async () => {
    mockGetDiscoveryModes.mockResolvedValue({
      modes: [
        {
          id: 'labels',
          label: 'Labels',
          description: 'Discover artists connected through label catalogs',
          availability: {
            enabled: false,
            fallbackUsed: false,
            providerPath: ['musicbrainz'],
            reason: 'This mode is not implemented yet.',
          },
          easyFields: [],
          advancedFields: [],
        },
        {
          id: 'release-radar',
          label: 'Release Radar',
          description: 'Discover fresh releases through fallback providers',
          availability: {
            enabled: true,
            fallbackUsed: true,
            providerPath: ['lastfm'],
            reason: 'Using fallback providers for release discovery.',
          },
          easyFields: [
            {
              key: 'windowDays',
              label: 'Window days',
              type: 'number',
              required: true,
            },
          ],
          advancedFields: [
            {
              key: 'windowDays',
              label: 'Window days',
              type: 'number',
              required: true,
            },
            {
              key: 'seedArtist',
              label: 'Seed artist',
              type: 'text',
              required: false,
            },
          ],
        },
      ],
    })
    mockRunDiscoveryMode.mockResolvedValue({ message: 'Discovery run started' })

    renderWithQuery(<DiscoveryModesPage />)

    expect(await screen.findByRole('heading', { name: 'Discovery Modes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Recommendations' })).toHaveAttribute(
      'href',
      '/discover',
    )
    await screen.findByText('This mode is not implemented yet.')
    await screen.findByText('Using fallback providers for release discovery.')

    const releaseRadarHeading = screen.getByRole('heading', { name: 'Release Radar' })
    const releaseRadarCard = releaseRadarHeading.closest('article')
    expect(releaseRadarCard).not.toBeNull()
    if (!releaseRadarCard) throw new Error('Missing release radar card')
    const releaseRadarQueries = within(releaseRadarCard)

    expect(releaseRadarQueries.getByRole('spinbutton')).toBeInTheDocument()
    expect(releaseRadarQueries.queryByText('Seed artist')).not.toBeInTheDocument()

    const labelsHeading = screen.getByRole('heading', { name: 'Labels' })
    const labelsCard = labelsHeading.closest('article')
    expect(labelsCard).not.toBeNull()
    if (!labelsCard) throw new Error('Missing labels card')
    const labelsQueries = within(labelsCard)
    expect(labelsQueries.getByRole('button', { name: 'Run discovery' })).toBeDisabled()
    fireEvent.click(labelsQueries.getByRole('button', { name: 'Run discovery' }))
    expect(mockRunDiscoveryMode).toHaveBeenCalledTimes(0)

    fireEvent.click(releaseRadarQueries.getByRole('button', { name: 'Advanced' }))

    expect(releaseRadarQueries.getByText('Seed artist')).toBeInTheDocument()

    fireEvent.click(releaseRadarQueries.getByRole('button', { name: 'Easy' }))
    fireEvent.change(releaseRadarQueries.getByRole('spinbutton'), { target: { value: '14' } })
    fireEvent.click(releaseRadarQueries.getByRole('button', { name: 'Run discovery' }))

    await waitFor(() => {
      expect(mockRunDiscoveryMode).toHaveBeenCalledWith({
        modeId: 'release-radar',
        settingsMode: 'easy',
        rawUserSettings: { windowDays: 14 },
        normalizedSettings: { windowDays: 14 },
        providerContext: { providerPath: ['lastfm'] },
        fallbackPolicy: 'allow-fallback',
      })
    })
  })
})
