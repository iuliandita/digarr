// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubscriptionFormData } from '@/web/components/subscription-form'
import type { DiscoveryModeResponse, Subscription } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getRequestLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

type SubscriptionFormMockProps = {
  discoveryModes?: DiscoveryModeResponse[]
  onSubmit?: (data: SubscriptionFormData) => Promise<void>
  [key: string]: unknown
}

const discoveryModeProps: SubscriptionFormMockProps[] = []

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    promise: vi.fn(),
  },
}))

vi.mock('@/web/components/subscription-form', async () => {
  const actual = await vi.importActual<typeof import('@/web/components/subscription-form')>(
    '@/web/components/subscription-form',
  )
  return {
    ...actual,
    SubscriptionForm: (props: SubscriptionFormMockProps) => {
      discoveryModeProps.push(props)
      return (
        <div
          data-testid="subscription-form"
          data-discovery-mode-count={props.discoveryModes?.length ?? 0}
        >
          Form
        </div>
      )
    },
  }
})

vi.mock('@/web/components/import-artists', () => ({
  ImportArtists: () => <div data-testid="import-artists" />,
}))

vi.mock('@/web/components/subscription-presets', () => ({
  SubscriptionPresets: () => <div data-testid="subscription-presets" />,
}))

vi.mock('@/web/components/hint', () => ({
  Hint: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/web/components/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('@/web/components/ui/skeleton', () => ({
  Skeleton: () => <div />,
}))

vi.mock('@/web/lib/api', () => ({
  bulkToggleSubscriptions: vi.fn(),
  listJobs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 1, isAdmin: true }),
  getJob: vi.fn(),
  runDiscoveryMode: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue({}),
  createSubscriptionApi: vi.fn(),
  deleteSubscriptionApi: vi.fn(),
  getOAuthStatus: vi.fn().mockResolvedValue({ connected: false }),
  getSchedulerInfo: vi.fn().mockResolvedValue({ jobs: [] }),
  getSettings: vi.fn().mockResolvedValue({
    lastfmUsername: 'listener',
    lastfmApiKey: 'key',
    listenbrainzUsername: null,
    listenbrainzToken: null,
    discogsUsername: null,
    subsonicUrl: null,
    subsonicUsername: null,
    subsonicPassword: null,
    discogsToken: null,
    preferences: {},
  }),
  getSubscriptionRuns: vi.fn(),
  getSubscriptions: vi.fn().mockResolvedValue([]),
  getDiscoveryModes: vi.fn().mockResolvedValue({
    modes: [
      {
        id: 'release-radar',
        label: 'Release Radar',
        description: 'Find fresh releases through the release radar mode.',
        availability: {
          enabled: true,
          fallbackUsed: false,
          providerPath: ['musicbrainz'],
          reason: null,
        },
        easyFields: [],
        advancedFields: [],
      },
    ],
  }),
  triggerSubscriptionRun: vi.fn(),
  updateSubscriptionApi: vi.fn(),
}))

import {
  createSubscriptionApi,
  getDiscoveryModes,
  getSchedulerInfo,
  getSubscriptions,
  triggerSubscriptionRun,
  updateSubscriptionApi,
} from '@/web/lib/api'
import { DiscoveryModesPage } from '@/web/pages/discovery-modes'

const mockCreateSubscriptionApi = vi.mocked(createSubscriptionApi)
const mockGetDiscoveryModes = vi.mocked(getDiscoveryModes)

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>
          <DiscoveryModesPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const baseSubscription: Subscription = {
  id: 1,
  name: 'Deezer favorites',
  userId: 1,
  enabled: true,
  sourceType: 'deezer',
  sourceProvider: 'deezer',
  sourceConfig: { feedType: 'favorites' },
  maxArtistsPerRun: 20,
  listenerRange: null,
  cron: '0 0 * * *',
  action: 'recommend',
  scoreThreshold: null,
  scoringWeightPreset: null,
  scoringWeightOverrides: null,
  lastRunAt: null,
  lastResultCount: null,
  lastError: null,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
}

describe('DiscoveryModesPage header controls (#993)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it.each([
    [1, false],
    [2, true],
  ])('with %i subscription(s) Pause all is shown: %s', async (count, shown) => {
    vi.mocked(getSubscriptions).mockResolvedValue(
      Array.from({ length: count }, (_, i) => ({
        ...baseSubscription,
        id: i + 1,
        name: `Sub ${i + 1}`,
      })),
    )
    renderPage()

    await screen.findByText('Sub 1')
    expect(!!screen.queryByRole('button', { name: /pause all/i })).toBe(shown)
    expect(screen.queryByRole('button', { name: 'Presets' })).toBeNull()
  })

  it('shows compact scheduled rows with last results, inline editing and pause', async () => {
    vi.mocked(getSubscriptions).mockResolvedValue([
      {
        ...baseSubscription,
        name: 'Weekly radar',
        sourceType: 'discovery-mode',
        sourceConfig: { modeId: 'release-radar', settingsMode: 'easy', settings: {} },
        lastRunAt: '2026-10-17T10:00:00.000Z',
        lastResultCount: 7,
      },
    ])
    vi.mocked(getSchedulerInfo).mockResolvedValue({
      jobs: [
        {
          name: 'subscription-1',
          nextRun: '2026-11-01T10:00:00.000Z',
        },
      ],
    } as never)
    renderPage()
    await screen.findByRole('heading', { name: 'Your modes' })
    const rowButton = await screen.findByRole('button', { name: 'Weekly radar' })
    expect(rowButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('subscription-form')).toBeNull()
    expect(screen.getByText(/7 found/)).toBeInTheDocument()
    expect(screen.getByText(/Next:/)).toBeInTheDocument()
    fireEvent.click(rowButton)
    expect(rowButton).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByTestId('subscription-form')).toBeInTheDocument()
    expect(discoveryModeProps.at(-1)).toMatchObject({
      mode: 'edit',
      initial: { name: 'Weekly radar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Disable subscription' }))
    await waitFor(() => expect(updateSubscriptionApi).toHaveBeenCalledWith(1, { enabled: false }))
    await act(async () => {
      await discoveryModeProps.at(-1)?.onSubmit?.({
        name: 'Weekly radar',
        sourceType: 'discovery-mode',
        sourceProvider: 'deezer',
        sourceConfig: { modeId: 'release-radar', settingsMode: 'easy', settings: {} },
        cron: '0 0 * * *',
        enabled: true,
        maxArtistsPerRun: 20,
        action: 'recommend',
        scoreThreshold: null,
        scoringWeightPreset: 'default',
      })
    })
    const saved = vi.mocked(updateSubscriptionApi).mock.calls.at(-1)?.[1]
    expect(saved).toMatchObject({ name: 'Weekly radar' })
    expect(saved).not.toHaveProperty('enabled')
  })

  it('opens presets and imports from the add flow', async () => {
    vi.mocked(getSubscriptions).mockResolvedValue([baseSubscription])
    renderPage()

    await screen.findByText(baseSubscription.name)
    expect(screen.queryByTestId('subscription-presets')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Run a mode' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Presets and imports' }))

    expect(await screen.findByTestId('subscription-presets')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('DiscoveryModesPage discovery mode support', () => {
  beforeEach(() => {
    discoveryModeProps.length = 0
    vi.clearAllMocks()
    localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    vi.mocked(getSubscriptions).mockResolvedValue([])
  })

  it('passes discovery modes into the subscription form when opening create', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run a mode' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Run a mode' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Release Radar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Schedule' }))

    expect(await screen.findByTestId('subscription-form')).toBeInTheDocument()
    expect(discoveryModeProps.at(-1)).toEqual(
      expect.objectContaining({
        discoveryModes: [expect.objectContaining({ id: 'release-radar' })],
      }),
    )
    expect(mockGetDiscoveryModes).toHaveBeenCalled()
    expect(mockCreateSubscriptionApi).not.toHaveBeenCalled()
  })

  it('shows the persisted subscription error after a manual run fails', async () => {
    const subscription: Subscription = {
      id: 42,
      name: 'Deezer favorites',
      userId: 1,
      enabled: true,
      sourceType: 'deezer',
      sourceProvider: 'deezer',
      sourceConfig: { feedType: 'favorites' },
      maxArtistsPerRun: 20,
      listenerRange: null,
      cron: '0 0 * * *',
      action: 'recommend',
      scoreThreshold: null,
      scoringWeightPreset: null,
      scoringWeightOverrides: null,
      lastRunAt: null,
      lastResultCount: null,
      lastError: null,
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
    }
    const error = 'Deezer connection expired. Reconnect your account.'
    vi.mocked(getSubscriptions)
      .mockResolvedValueOnce([subscription])
      .mockResolvedValue([{ ...subscription, lastError: error }])
    vi.mocked(triggerSubscriptionRun).mockRejectedValueOnce(new Error(error))

    renderPage()

    await screen.findByText(subscription.name)
    expect(screen.queryByTitle(error)).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Run now'))

    expect(await screen.findByTitle(error)).toBeInTheDocument()
    expect(triggerSubscriptionRun).toHaveBeenCalledWith(subscription.id)
    expect(toast.error).toHaveBeenCalledWith('Failed to trigger run')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
