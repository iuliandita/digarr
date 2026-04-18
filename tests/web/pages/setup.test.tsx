// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getRequestLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

vi.mock('@/web/lib/api', () => ({
  completeSetup: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { getStoredLocale } from '@/web/lib/locale-storage'
import { SetupWizard } from '@/web/pages/setup'

const mockGetStoredLocale = vi.mocked(getStoredLocale)

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

  it('uses translated setup input placeholders in French', async () => {
    mockGetStoredLocale.mockReturnValue('fr')
    renderSetupWizard()

    fireEvent.click(screen.getByRole('button', { name: /lidarr/i }))
    await screen.findByText(/Connect(?:er)? Lidarr/i)
    expect(screen.getByPlaceholderText('Votre clé API Lidarr')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retour/i }))
    fireEvent.click(screen.getByRole('button', { name: /emby/i }))
    await screen.findByText(/Connect(?:er)? Emby/i)
    expect(screen.getByPlaceholderText('Votre clé API Emby')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('ID utilisateur Emby')).toBeInTheDocument()
  })

  it('renders a language switcher during setup', () => {
    renderSetupWizard()

    expect(screen.getByLabelText('Language')).toBeInTheDocument()
  })

  it('uses translated discovery setup copy in French', async () => {
    mockGetStoredLocale.mockReturnValue('fr')
    renderSetupWizard()

    fireEvent.click(
      screen.getByRole('button', { name: /découverte uniquement|decouvrir|just discover/i }),
    )

    await screen.findByText('Fournisseur IA')
    expect(
      screen.getByText(
        /Vous connecterez vos sources d'écoute personnelles plus tard dans les paramètres/i,
      ),
    ).toBeInTheDocument()
  })

  it('uses translated AI model suggestion labels in French', async () => {
    mockGetStoredLocale.mockReturnValue('fr')
    renderSetupWizard()

    fireEvent.click(screen.getByRole('button', { name: /lidarr/i }))
    await screen.findByText(/Connect(?:er)? Lidarr/i)
    await fillAndContinueLidarr()

    await screen.findByText('Fournisseur IA')
    expect(screen.getByText('Haiku 4.5 (rapide, le moins cher)')).toBeInTheDocument()
    expect(screen.getByText('Sonnet 4.6 (équilibré)')).toBeInTheDocument()
  })

  it('uses a translated fallback model placeholder in French for openai-compatible', async () => {
    mockGetStoredLocale.mockReturnValue('fr')
    renderSetupWizard()

    fireEvent.click(screen.getByRole('button', { name: /lidarr/i }))
    await screen.findByText(/Connect(?:er)? Lidarr/i)
    await fillAndContinueLidarr()

    fireEvent.change(screen.getByLabelText(/(?:Provider|Fournisseur)/i), {
      target: { value: 'openai-compatible' },
    })

    expect(screen.getByPlaceholderText('nom-du-modèle')).toBeInTheDocument()
  })
})
