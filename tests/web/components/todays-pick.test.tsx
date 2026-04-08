// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/web/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/web/lib/api')>()
  return {
    ...actual,
    getAlbums: vi.fn().mockResolvedValue([]),
    getUserPreferences: vi.fn().mockResolvedValue({ dismissedHints: [] }),
    updateUserPreferences: vi.fn().mockResolvedValue({}),
  }
})

import { TodaysPick } from '@/web/components/todays-pick'

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const rec = {
  id: 1,
  score: 0.82,
  status: 'pending',
  aiReasoning: 'Worth a listen.',
  artist: {
    id: 10,
    name: 'Radiohead',
    mbid: 'mbid-001',
    genres: ['rock'],
    imageUrl: null,
    logoUrl: null,
    streamingUrls: null,
  },
}

describe('TodaysPick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides playlist-only targets from the approve dropdown', () => {
    renderWithQuery(
      <TodaysPick
        rec={rec}
        loading={false}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onSkip={vi.fn()}
        onRunScan={vi.fn()}
        targets={[
          { id: 1, type: 'lidarr', name: 'Main Lidarr' },
          { id: 2, type: 'lidarr', name: 'Backup Lidarr' },
          { id: 3, type: 'spotify-playlist', name: 'Spotify Mixes' },
        ]}
        onApproveToTarget={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Approve to specific target'))

    expect(screen.getByText('Add to Main Lidarr')).toBeInTheDocument()
    expect(screen.getByText('Add to Backup Lidarr')).toBeInTheDocument()
    expect(screen.queryByText('Add to Spotify playlist')).not.toBeInTheDocument()
  })
})
