// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

vi.mock('@/web/lib/api', () => ({
  completeSetup: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public data: unknown,
    ) {
      super('Missing required fields')
    }
  },
}))

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

import { toast } from 'sonner'
import { ApiError, completeSetup } from '@/web/lib/api'
import { getStoredLocale } from '@/web/lib/locale-storage'
import { SetupWizard } from '@/web/pages/setup'

const mockGetStoredLocale = vi.mocked(getStoredLocale)
const mockCompleteSetup = vi.mocked(completeSetup)
const mockToastError = vi.mocked(toast.error)

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStoredLocale.mockReturnValue('en')
  })

  function renderSetupWizard() {
    return render(
      <I18nProvider>
        <SetupWizard onComplete={vi.fn()} />
      </I18nProvider>,
    )
  }

  async function goToLidarrStep() {
    renderSetupWizard()
    fireEvent.click(screen.getByRole('button', { name: /Lidarr/i }))
    await screen.findByText(/Connect(?:er)? Lidarr/i)
  }

  async function fillAndContinueLidarr() {
    fireEvent.change(screen.getByLabelText(/(?:Lidarr URL|URL Lidarr)/i), {
      target: { value: 'http://localhost:8686' },
    })
    fireEvent.change(screen.getByLabelText(/(?:API Key|Clé API)/i), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue|continuer/i }))
  }

  it('moves to AI setup after continuing past Lidarr details', async () => {
    await goToLidarrStep()
    await fillAndContinueLidarr()

    await screen.findByText('AI Provider')
    expect(
      screen.queryByText(/We'll start syncing your library in the background/i),
    ).not.toBeInTheDocument()
  })

  it('discovery mode goes straight to AI setup', async () => {
    renderSetupWizard()
    fireEvent.click(screen.getByRole('button', { name: /Just discover/i }))

    await screen.findByText('AI Provider')
    expect(
      screen.getByText(
        /You'll connect personal listening sources later in Settings after you log in\./i,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Listening Sources')).not.toBeInTheDocument()
  })

  it('shows Emby as a setup mode option', async () => {
    renderSetupWizard()
    expect(screen.getByRole('button', { name: /Emby/i })).toBeInTheDocument()
  })

  it('emby mode reveals the Emby connection step', async () => {
    renderSetupWizard()
    fireEvent.click(screen.getByRole('button', { name: /Emby/i }))

    await screen.findByText('Connect Emby')
    expect(screen.getByLabelText('Emby URL')).toBeInTheDocument()
    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    expect(screen.getByLabelText('User ID')).toBeInTheDocument()
  })

  it('surfaces the backend error (and missing fields) when setup completion fails', async () => {
    mockCompleteSetup.mockRejectedValueOnce(
      new ApiError(400, { error: 'Missing required fields', fields: ['aiModel'] }),
    )
    renderSetupWizard()

    fireEvent.click(screen.getByRole('button', { name: /Just discover/i }))
    await screen.findByText('AI Provider')
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'test-model' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret-key' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    fireEvent.click(await screen.findByRole('button', { name: /Start Digging/i }))

    await vi.waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockToastError).toHaveBeenCalledWith('Missing required fields: aiModel')
  })

  it('says why Continue is disabled and shows the provider name in the summary', async () => {
    renderSetupWizard()
    fireEvent.click(screen.getByRole('button', { name: /Just discover/i }))
    await screen.findByText('AI Provider')

    expect(screen.getByLabelText('Model')).toHaveAttribute(
      'placeholder',
      'e.g. claude-haiku-4-5-20251001',
    )
    expect(screen.getByText('To continue, fill in: Model, API Key')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'test-model' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret-key' } })
    expect(screen.queryByText(/To continue, fill in/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText('Anthropic / test-model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument()
  })

  it('lets discovery-only setup skip the AI provider (#887)', async () => {
    mockCompleteSetup.mockResolvedValueOnce(undefined as never)
    renderSetupWizard()

    fireEvent.click(screen.getByRole('button', { name: /Just discover/i }))
    await screen.findByText('AI Provider')
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'half-typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(await screen.findByText('Not set up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Start Digging/i }))
    await vi.waitFor(() => expect(mockCompleteSetup).toHaveBeenCalledWith({}))
  })

  it('hides skip-TLS under Advanced on the Lidarr step and sends the value when set', async () => {
    mockCompleteSetup.mockResolvedValueOnce(undefined as never)
    await goToLidarrStep()
    const checkbox = screen.getByLabelText('Skip TLS verification')
    expect(checkbox).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(checkbox).toBeVisible()
    expect(screen.getByText(/Disables certificate checks/)).toBeVisible()
    fireEvent.click(checkbox)
    await fillAndContinueLidarr()
    await screen.findByText('AI Provider')
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    fireEvent.click(await screen.findByRole('button', { name: /Start Digging/i }))
    await vi.waitFor(() =>
      expect(mockCompleteSetup).toHaveBeenCalledWith(
        expect.objectContaining({ skipTlsVerify: true }),
      ),
    )
  })

  it('reopens Advanced automatically when skip-TLS is already on', async () => {
    await goToLidarrStep()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.click(screen.getByLabelText('Skip TLS verification'))
    await fillAndContinueLidarr()
    await screen.findByText('AI Provider')
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    await screen.findByText(/Connect(?:er)? Lidarr/i)
    expect(screen.getByLabelText('Skip TLS verification')).toBeVisible()
  })
})
