// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

function createQueryWrapper() {
  const client = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <I18nProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nProvider>
  )
}

function renderWithQuery(ui: ReactElement) {
  return render(ui, { wrapper: createQueryWrapper() })
}

vi.mock('@/web/lib/api', () => ({
  getPipelineStatus: vi.fn(),
  cancelPipeline: vi.fn(),
}))

// Mock useSSE to avoid real EventSource in jsdom
vi.mock('@/web/lib/hooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/web/lib/hooks')>()
  return {
    ...original,
    useSSE: vi.fn(() => ({ data: null, connected: false })),
  }
})

import { PipelineProgress } from '@/web/components/pipeline-progress'
import { cancelPipeline, getPipelineStatus } from '@/web/lib/api'
import { useSSE } from '@/web/lib/hooks'
import { createTestQueryClient } from '../helpers/query'

const mockGetPipelineStatus = vi.mocked(getPipelineStatus)
const mockUseSSE = vi.mocked(useSSE)

describe('PipelineProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when pipeline is not running and no SSE data', async () => {
    mockGetPipelineStatus.mockResolvedValue({ running: false })
    mockUseSSE.mockReturnValue({ data: null, connected: false })

    const { container } = renderWithQuery(<PipelineProgress />)

    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('renders stage label and percentage when pipeline is running', async () => {
    mockGetPipelineStatus.mockResolvedValue({ running: true, stage: 'analyze' })
    mockUseSSE.mockReturnValue({ data: null, connected: false })

    renderWithQuery(<PipelineProgress />)

    await waitFor(() => {
      expect(screen.getByText('Building taste profile')).toBeInTheDocument()
      // analyze is index 1, so (1+1)/8 = 25%
      expect(screen.getByText('25%')).toBeInTheDocument()
    })
  })

  it('renders SSE progress data with current/total counts', async () => {
    mockGetPipelineStatus.mockResolvedValue({ running: true, stage: 'collect' })
    mockUseSSE.mockReturnValue({
      data: { stage: 'resolve', current: 5, total: 20, message: 'Looking up artists...' },
      connected: true,
    })

    renderWithQuery(<PipelineProgress />)

    await waitFor(() => {
      expect(screen.getByText('Looking up metadata')).toBeInTheDocument()
      expect(screen.getByText('5/20')).toBeInTheDocument()
      expect(screen.getByText('Looking up artists...')).toBeInTheDocument()
    })
  })

  it('shows complete stage label', async () => {
    mockGetPipelineStatus.mockResolvedValue({ running: true, stage: 'store' })
    mockUseSSE.mockReturnValue({
      data: { stage: 'complete' },
      connected: true,
    })

    renderWithQuery(<PipelineProgress />)

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeInTheDocument()
      expect(screen.getByText('100%')).toBeInTheDocument()
    })
  })

  it('fires onComplete exactly once when stage reaches complete', async () => {
    const onComplete = vi.fn()
    mockGetPipelineStatus.mockResolvedValue({ running: true, stage: 'store' })
    mockUseSSE.mockReturnValue({
      data: { stage: 'complete' },
      connected: true,
    })

    const { rerender } = render(<PipelineProgress onComplete={onComplete} />, {
      wrapper: createQueryWrapper(),
    })

    // The component uses setTimeout(onComplete, 500) - advance timers
    await waitFor(() => {
      expect(screen.getByText('Done')).toBeInTheDocument()
    })
    vi.advanceTimersByTime(600)
    expect(onComplete).toHaveBeenCalledTimes(1)

    // Re-render should NOT fire again
    rerender(<PipelineProgress onComplete={onComplete} />)
    vi.advanceTimersByTime(600)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
  it('reenables Stop when cancellation is declined during completion', async () => {
    mockGetPipelineStatus.mockResolvedValue({ running: true, stage: 'store' })
    mockUseSSE.mockReturnValue({ data: null, connected: false })
    vi.mocked(cancelPipeline).mockResolvedValue({ cancelled: false, message: 'Pipeline finishing' })
    renderWithQuery(<PipelineProgress />)
    const stop = await screen.findByRole('button', { name: 'Stop scan' })
    fireEvent.click(stop)
    await waitFor(() => expect(stop).toBeEnabled())
    expect(cancelPipeline).toHaveBeenCalledOnce()
  })
})
