// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryModeResponse } from '@/web/lib/api'

type SubscriptionFormMockProps = {
  discoveryModes?: DiscoveryModeResponse[]
  [key: string]: unknown
}

const discoveryModeProps: SubscriptionFormMockProps[] = []

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
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

import { createSubscriptionApi, getDiscoveryModes } from '@/web/lib/api'
import SubscriptionsPage from '@/web/pages/subscriptions'

const mockCreateSubscriptionApi = vi.mocked(createSubscriptionApi)
const mockGetDiscoveryModes = vi.mocked(getDiscoveryModes)

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <SubscriptionsPage />
    </QueryClientProvider>,
  )
}

describe('SubscriptionsPage discovery mode support', () => {
  beforeEach(() => {
    discoveryModeProps.length = 0
    vi.clearAllMocks()
  })

  it('passes discovery modes into the subscription form when opening create', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /New/i }))

    expect(await screen.findByTestId('subscription-form')).toBeInTheDocument()
    expect(discoveryModeProps.at(-1)).toEqual(
      expect.objectContaining({
        discoveryModes: [expect.objectContaining({ id: 'release-radar' })],
      }),
    )
    expect(mockGetDiscoveryModes).toHaveBeenCalled()
    expect(mockCreateSubscriptionApi).not.toHaveBeenCalled()
  })
})
