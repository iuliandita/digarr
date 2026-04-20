// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getRequestLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{ui}</I18nProvider>
    </QueryClientProvider>,
  )
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    promise: vi.fn(),
  },
}))

vi.mock('@/web/lib/api', () => ({
  getRecommendations: vi.fn(async () => ({ items: [], total: 0 })),
  updateRecommendation: vi.fn(),
  approveRecommendation: vi.fn().mockResolvedValue({}),
  approveToTarget: vi.fn().mockResolvedValue({}),
  listTargets: vi.fn().mockResolvedValue([]),
  getTopArtists: vi.fn(async () => ({
    tracks: [],
    total: 0,
    offset: 0,
    limit: 5,
    source: null,
  })),
  getRecentTracks: vi.fn(async () => ({ tracks: [], hasSource: false, source: null })),
  getSubscriptions: vi.fn(async () => []),
  getSchedulerInfo: vi.fn(async () => ({ jobs: [] })),
  getDashboardTaste: vi.fn(async () => []),
  getDashboardActivity: vi.fn(async () => []),
  triggerPipeline: vi.fn(),
  rescanArtists: vi.fn().mockResolvedValue({ updated: 0, total: 0 }),
  moodDiscover: vi.fn(),
  quickDiscover: vi.fn(),
  getPipelineStatus: vi.fn(async () => ({ running: false })),
  getStoredToken: vi.fn(() => null),
  getUserPreferences: vi.fn().mockResolvedValue({ dismissedHints: [] }),
  updateUserPreferences: vi.fn().mockResolvedValue({}),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 1, username: 'user', isAdmin: false }),
  getJobHealth: vi.fn().mockResolvedValue({
    pipeline: { status: 'ok', lastRun: null, nextRun: null },
    subscriptions: { status: 'ok', healthy: 0, total: 0 },
    playlists: { status: 'ok', lastRun: null },
    sources: {},
  }),
}))

vi.mock('@/web/lib/hooks', () => ({
  useSSE: vi.fn(() => ({ data: null, connected: false })),
}))

import { Dashboard } from '@/web/pages/dashboard'

describe('Dashboard listening empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mentions only the listening sources used by the card', async () => {
    renderWithQuery(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText(/Connect your Last\.fm or ListenBrainz account/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Spotify/i)).not.toBeInTheDocument()
  })
})
