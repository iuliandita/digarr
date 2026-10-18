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
  volume: 1,
  setVolume: vi.fn(),
  audition: {
    unavailable: [],
    selectedCount: 0,
    dismissSummary: vi.fn(),
    active: false,
    index: 0,
    count: 0,
    current: null,
    start: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    stop: vi.fn(),
  },
}

function renderWithQuery(ui: ReactElement, initialEntries: string[] = ['/']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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
  getSettings: vi.fn().mockResolvedValue({ preferences: {} }),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 1, isAdmin: true }),
  getOAuthStatus: vi.fn().mockResolvedValue({ connected: false }),
  getSubscriptions: vi.fn().mockResolvedValue([]),
  getSchedulerInfo: vi.fn().mockResolvedValue({ jobs: [] }),
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getJob: vi.fn(),
  updateSettings: vi.fn().mockResolvedValue({}),
  getUserPreferences: vi.fn().mockResolvedValue({}),
  updateUserPreferences: vi.fn().mockResolvedValue({}),
  createSubscriptionApi: vi.fn().mockResolvedValue({}),
  updateSubscriptionApi: vi.fn(),
  deleteSubscriptionApi: vi.fn(),
  triggerSubscriptionRun: vi.fn(),
  bulkToggleSubscriptions: vi.fn(),
  getSubscriptionRuns: vi.fn().mockResolvedValue([]),
}))

import {
  getCurrentUser,
  getDiscoveryModes,
  getSettings,
  listJobs,
  runDiscoveryMode,
  updateSettings,
} from '@/web/lib/api'
import { DiscoveryModesPage } from '@/web/pages/discovery-modes'

const mockGetDiscoveryModes = vi.mocked(getDiscoveryModes)
const mockRunDiscoveryMode = vi.mocked(runDiscoveryMode)

describe('DiscoveryModesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(getSettings).mockResolvedValue({ preferences: {} } as never)
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 1, isAdmin: true } as never)
    vi.mocked(listJobs).mockResolvedValue({ items: [], total: 0 })
    Element.prototype.scrollIntoView = vi.fn()
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver
    Element.prototype.scrollIntoView = vi.fn()
  })

  it.each([
    ['gap-fill', 'Library Gap-Fill'],
    ['release-radar', 'Release Radar'],
  ])('focuses and reveals the requested %s mode from a deep link', async (modeId, label) => {
    mockGetDiscoveryModes.mockResolvedValue({
      modes: [
        {
          id: 'gap-fill',
          label: 'Library Gap-Fill',
          description: 'Find missing albums',
          availability: {
            enabled: true,
            fallbackUsed: false,
            providerPath: ['musicbrainz'],
          },
          easyFields: [],
          advancedFields: [],
        },
        {
          id: 'release-radar',
          label: 'Release Radar',
          description: 'Find new releases',
          availability: {
            enabled: true,
            fallbackUsed: false,
            providerPath: ['musicbrainz'],
          },
          easyFields: [],
          advancedFields: [],
        },
      ],
    })

    renderWithQuery(<DiscoveryModesPage />, [`/discovery-modes?mode=${modeId}`])

    const requestedHeading = await screen.findByRole('heading', { name: label })
    const requestedCard = requestedHeading.closest<HTMLElement>('[id^="discovery-mode-"]')
    expect(requestedCard).not.toBeNull()
    expect(requestedCard).toHaveAttribute('id', `discovery-mode-${modeId}`)
    await waitFor(() => expect(requestedCard).toHaveFocus())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
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
    expect(screen.queryByRole('heading', { name: 'Release Radar' })).toBeNull()
    expect(
      await screen.findByText(
        'Nothing here yet - pick a mode to run it once or put it on a schedule.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run a mode' }))
    const search = screen.getByRole('searchbox', { name: 'Search modes' })
    expect(search).toHaveFocus()
    await screen.findByText('This mode is not implemented yet.')
    await screen.findByText('Using fallback providers for release discovery.')
    expect(screen.getByRole('button', { name: 'Labels' })).toBeDisabled()
    fireEvent.change(search, { target: { value: 'radar' } })
    expect(screen.queryByRole('button', { name: 'Labels' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Release Radar' }))

    const releaseRadarHeading = screen.getByRole('heading', { name: 'Release Radar' })
    const releaseRadarCard = releaseRadarHeading.closest<HTMLElement>('[id^="discovery-mode-"]')
    expect(releaseRadarCard).not.toBeNull()
    if (!releaseRadarCard) throw new Error('Missing release radar card')
    const releaseRadarQueries = within(releaseRadarCard)

    expect(releaseRadarQueries.getByRole('spinbutton')).toBeInTheDocument()
    expect(releaseRadarQueries.queryByText('Seed artist')).not.toBeInTheDocument()

    fireEvent.click(releaseRadarQueries.getByRole('button', { name: 'Advanced' }))

    expect(releaseRadarQueries.getByText('Seed artist')).toBeInTheDocument()

    fireEvent.click(releaseRadarQueries.getByRole('button', { name: 'Easy' }))
    fireEvent.change(releaseRadarQueries.getByRole('spinbutton'), { target: { value: '14' } })
    fireEvent.click(releaseRadarQueries.getByRole('button', { name: 'Run now' }))

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

  it('filters experimental modes behind the shared Connections preference', async () => {
    mockGetDiscoveryModes.mockResolvedValue({
      modes: [
        {
          id: 'tidal-favorite-artists',
          label: 'TIDAL Favorite Artists',
          description: 'Favorites',
          stability: 'experimental',
          availability: { enabled: true, fallbackUsed: false, providerPath: ['tidal'] },
          easyFields: [],
          advancedFields: [],
        },
      ],
    })
    renderWithQuery(<DiscoveryModesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run a mode' }))
    expect(screen.queryByRole('button', { name: 'TIDAL Favorite Artists' })).toBeNull()
    vi.mocked(getSettings).mockResolvedValue({
      preferences: { showExperimentalIntegrations: true },
    } as never)
    fireEvent.click(screen.getByRole('checkbox', { name: /Show experimental integrations/ }))
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        preferences: { showExperimentalIntegrations: true },
      }),
    )
    expect(
      await screen.findByRole('button', { name: 'TIDAL Favorite Artists' }),
    ).toBeInTheDocument()
  })

  it('shows only the member own browser history and never requests admin job history', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 1, isAdmin: false } as never)
    mockGetDiscoveryModes.mockResolvedValue({
      modes: [
        {
          id: 'release-radar',
          label: 'Release Radar',
          description: 'Fresh releases',
          availability: { enabled: true, fallbackUsed: false, providerPath: ['lastfm'] },
          easyFields: [],
          advancedFields: [],
        },
      ],
    })
    localStorage.setItem(
      'digarr:discovery-runs:1',
      JSON.stringify([
        {
          id: 5,
          userId: 1,
          status: 'started',
          startedAt: '2026-10-17T10:00:00Z',
          metadata: { discoveryMode: { modeId: 'release-radar' } },
        },
        {
          id: 6,
          userId: 2,
          status: 'failed',
          error: 'Other user secret error',
          startedAt: '2026-10-18T10:00:00Z',
          metadata: { discoveryMode: { modeId: 'release-radar' } },
        },
      ]),
    )
    renderWithQuery(<DiscoveryModesPage />)
    const row = await screen.findByRole('button', { name: /^Release Radar/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Other user secret error')).toBeNull()
    expect(listJobs).not.toHaveBeenCalled()
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('heading', { name: 'Release Radar' })).toBeInTheDocument()
  })
})
