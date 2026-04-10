// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewContext } from '@/web/lib/preview-context'

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

import { getDiscoveryModes } from '@/web/lib/api'
import { DiscoverPage } from '@/web/pages/discover'

const mockGetDiscoveryModes = vi.mocked(getDiscoveryModes)

describe('DiscoverPage discovery modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  it('renders discovery mode cards and disables strict ListenBrainz mode when unavailable', async () => {
    mockGetDiscoveryModes.mockResolvedValue({
      modes: [
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

    renderWithQuery(<DiscoverPage />)

    expect(await screen.findByText('ListenBrainz')).toBeInTheDocument()
    expect(screen.getByText(/connect listenbrainz/i)).toBeInTheDocument()
  })
})
