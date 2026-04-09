// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/web/lib/api', () => ({
  completeSetup: vi.fn(),
  testService: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { testService } from '@/web/lib/api'
import { SetupWizard } from '@/web/pages/setup'

const mockTestService = vi.mocked(testService)

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function goToLidarrStep() {
    render(<SetupWizard onComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Lidarr/i }))
    await screen.findByText('Connect Lidarr')
  }

  async function fillAndTestLidarr() {
    fireEvent.change(screen.getByLabelText('Lidarr URL'), {
      target: { value: 'http://localhost:8686' },
    })
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test & Continue' }))
  }

  it('shows the background sync note after a successful Lidarr test', async () => {
    mockTestService.mockResolvedValue({ success: true, message: 'Connected' })

    await goToLidarrStep()
    await fillAndTestLidarr()

    await waitFor(() => {
      expect(mockTestService).toHaveBeenCalledWith('lidarr', {
        url: 'http://localhost:8686',
        apiKey: 'secret',
        skipTlsVerify: false,
      })
    })

    await screen.findByText('AI Provider')
    expect(
      screen.getByText(
        "Connected. We'll start syncing your library in the background. The first sync may take a while (see Library Health for progress).",
      ),
    ).toBeInTheDocument()
  })

  it('does not show the background sync note after a failed Lidarr test', async () => {
    mockTestService.mockResolvedValue({ success: false, message: 'Nope' })

    await goToLidarrStep()
    await fillAndTestLidarr()

    await waitFor(() => {
      expect(mockTestService).toHaveBeenCalled()
    })

    expect(screen.getByText('Connect Lidarr')).toBeInTheDocument()
    expect(
      screen.queryByText(
        "Connected. We'll start syncing your library in the background. The first sync may take a while (see Library Health for progress).",
      ),
    ).not.toBeInTheDocument()
  })

  it('discovery mode goes straight to AI setup', async () => {
    render(<SetupWizard onComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Just discover/i }))

    await screen.findByText('AI Provider')
    expect(
      screen.getByText(
        /You'll connect personal listening sources later in Settings after you log in\./i,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Listening Sources')).not.toBeInTheDocument()
  })
})
