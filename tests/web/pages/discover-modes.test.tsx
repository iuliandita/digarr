// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewContext } from '@/web/lib/preview-context'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  promise: vi.fn(),
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
    <QueryClientProvider client={client}>
      <PreviewContext.Provider value={noopPreview}>{ui}</PreviewContext.Provider>
    </QueryClientProvider>,
  )
}

vi.mock('@/web/lib/api', () => ({
  getRecommendations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  updateRecommendation: vi.fn(),
  approveRecommendation: vi.fn(),
  approveToTarget: vi.fn(),
  bulkAction: vi.fn(),
  getWarmStatuses: vi.fn().mockResolvedValue({ statuses: {} }),
  rescanArtists: vi.fn(),
  triggerPipeline: vi.fn(),
  listTargets: vi.fn().mockResolvedValue([]),
  exportRecommendations: vi.fn(),
  getUserPreferences: vi.fn().mockResolvedValue({}),
  getLidarrProfiles: vi.fn().mockResolvedValue([{ id: 1, name: 'Any' }]),
  getLidarrMetadataProfiles: vi.fn().mockResolvedValue([{ id: 1, name: 'Standard' }]),
  getLidarrRootFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/music', freeSpace: 0 }]),
  getDiscoveryModes: vi.fn(),
  runDiscoveryMode: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast,
}))

import { getDiscoveryModes, runDiscoveryMode } from '@/web/lib/api'
import { DiscoverPage } from '@/web/pages/discover'

const mockGetDiscoveryModes = getDiscoveryModes as typeof getDiscoveryModes & {
  mockResolvedValue: (value: Awaited<ReturnType<typeof getDiscoveryModes>>) => void
}
const mockRunDiscoveryMode = runDiscoveryMode as typeof runDiscoveryMode & {
  mockResolvedValue: (value: Awaited<ReturnType<typeof runDiscoveryMode>>) => void
}

describe('DiscoverPage discovery modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver
  })

  it('switches between easy and advanced fields and submits the exact discovery mode payload', async () => {
    mockGetDiscoveryModes.mockResolvedValue({
      modes: [
        {
          id: 'labels',
          label: 'Labels',
          description: 'Discover artists connected through label catalogs',
          availability: {
            enabled: true,
            fallbackUsed: true,
            providerPath: ['musicbrainz'],
            reason: 'Preferred provider unavailable; fallback will be used.',
          },
          easyFields: [
            {
              key: 'seedArtists',
              label: 'Seed artists',
              type: 'multiselect',
              required: true,
            },
          ],
          advancedFields: [
            {
              key: 'seedArtists',
              label: 'Seed artists',
              type: 'multiselect',
              required: true,
            },
            {
              key: 'limit',
              label: 'Limit',
              type: 'number',
              required: true,
            },
          ],
        },
        {
          id: 'listenbrainz',
          label: 'ListenBrainz',
          description: 'Discover from ListenBrainz graph data and feeds',
          availability: {
            enabled: false,
            fallbackUsed: false,
            providerPath: [],
            reason: 'Connect ListenBrainz to use this mode.',
          },
          easyFields: [],
          advancedFields: [],
        },
      ],
    })
    mockRunDiscoveryMode.mockResolvedValue({ message: 'Discovery run started' })

    renderWithQuery(<DiscoverPage />)

    const labelsCardHeading = await screen.findByText('Labels')
    const labelsCard = labelsCardHeading.closest('article')
    expect(labelsCard).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: checked above
    const labelsCardQueries = within(labelsCard!)

    expect(labelsCardQueries.getByText(/preferred provider unavailable/i)).toBeInTheDocument()
    expect(labelsCardQueries.getByRole('button', { name: 'Easy' })).toBeInTheDocument()
    expect(labelsCardQueries.getByRole('button', { name: 'Advanced' })).toBeInTheDocument()
    expect(labelsCardQueries.getByText('Seed artists')).toBeInTheDocument()
    expect(labelsCardQueries.queryByText('Limit')).not.toBeInTheDocument()

    fireEvent.click(labelsCardQueries.getByRole('button', { name: 'Advanced' }))

    expect(labelsCardQueries.getByText('Limit')).toBeInTheDocument()

    const textboxes = labelsCardQueries.getAllByRole('textbox')
    const seedArtistsInput = textboxes[0]
    expect(seedArtistsInput).toBeDefined()
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    fireEvent.change(seedArtistsInput!, { target: { value: 'Broadcast, Stereolab' } })
    fireEvent.change(labelsCardQueries.getByRole('spinbutton'), { target: { value: '25' } })
    fireEvent.click(labelsCardQueries.getByRole('button', { name: 'Run discovery' }))

    await waitFor(() => {
      expect(mockRunDiscoveryMode).toHaveBeenCalledWith({
        modeId: 'labels',
        settingsMode: 'advanced',
        rawUserSettings: {
          seedArtists: ['Broadcast', 'Stereolab'],
          limit: 25,
        },
        normalizedSettings: {
          seedArtists: ['Broadcast', 'Stereolab'],
          limit: 25,
        },
        providerContext: {
          providerPath: ['musicbrainz'],
        },
        fallbackPolicy: 'allow-fallback',
      })
    })

    expect(toast.success).toHaveBeenCalledWith(
      'Discovery run started -- check Dashboard for progress',
    )

    expect(await screen.findByText('ListenBrainz')).toBeInTheDocument()
    expect(screen.getByText(/connect listenbrainz/i)).toBeInTheDocument()

    const listenBrainzHeading = screen.getByText('ListenBrainz')
    const listenBrainzCard = listenBrainzHeading.closest('article')
    expect(listenBrainzCard).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: checked above
    const listenBrainzQueries = within(listenBrainzCard!)
    const disabledSubmit = listenBrainzQueries.getByRole('button', { name: 'Run discovery' })

    expect(disabledSubmit).toBeDisabled()
    fireEvent.click(disabledSubmit)
    expect(mockRunDiscoveryMode).toHaveBeenCalledTimes(1)
  })
})
