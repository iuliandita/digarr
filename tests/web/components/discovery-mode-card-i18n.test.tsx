// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'it'),
  getRequestLocale: vi.fn(() => 'it'),
  getStoredLocale: vi.fn(() => 'it'),
  setStoredLocale: vi.fn(),
}))

import { DiscoveryModeCard } from '@/web/components/discovery-mode-card'

describe('DiscoveryModeCard i18n', () => {
  it('translates aliased discovery ids, fields, help text, and option labels', () => {
    render(
      <I18nProvider>
        <DiscoveryModeCard
          mode={{
            id: 'lb-artist-radio',
            label: 'Artist Radio',
            description: 'Discover artists similar to a seed artist via ListenBrainz radio',
            availability: {
              enabled: true,
              fallbackUsed: false,
              providerPath: [],
            },
            easyFields: [
              {
                key: 'seedArtistMbid',
                label: 'Artist',
                type: 'text',
                required: true,
                helpText: 'Artist name or MBID to seed the radio',
              },
              {
                key: 'adventurousness',
                label: 'Adventurousness',
                type: 'select',
                options: [
                  { value: 'easy', label: 'Safe' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'hard', label: 'Adventurous' },
                ],
              },
            ],
            advancedFields: [],
          }}
          onRun={vi.fn().mockResolvedValue(undefined)}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('Radio artista')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Scopri artisti simili a un artista di partenza tramite la radio di ListenBrainz',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Artista')).toBeInTheDocument()
    expect(screen.getByText('Nome artista o MBID per avviare la radio')).toBeInTheDocument()
    expect(screen.getByText('Avventura')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Sicuro' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Medio' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Avventuroso' })).toBeInTheDocument()
  })

  it('translates aliased field keys and known availability reasons', () => {
    render(
      <I18nProvider>
        <DiscoveryModeCard
          mode={{
            id: 'release-radar',
            label: 'Release Radar',
            description: 'Discover from new releases connected to your tracked artists',
            availability: {
              enabled: false,
              fallbackUsed: false,
              providerPath: [],
              reason: 'Connect a listening source first.',
            },
            easyFields: [
              {
                key: 'windowDays',
                label: 'Release window',
                type: 'number',
                required: true,
              },
            ],
            advancedFields: [],
          }}
          onRun={vi.fn().mockResolvedValue(undefined)}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('Radar uscite')).toBeInTheDocument()
    expect(screen.getByText('Finestra di uscita')).toBeInTheDocument()
    expect(screen.getByText('Non disponibile perché')).toBeInTheDocument()
    expect(screen.getByText("Collega prima una sorgente d'ascolto.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ignora' }))
    expect(screen.queryByText("Collega prima una sorgente d'ascolto.")).not.toBeInTheDocument()
  })

  it('translates the not-implemented-yet availability reason', () => {
    render(
      <I18nProvider>
        <DiscoveryModeCard
          mode={{
            id: 'labels',
            label: 'Labels',
            description: 'Discover artists from label catalogs and scenes',
            availability: {
              enabled: false,
              fallbackUsed: false,
              providerPath: [],
              reason: 'This mode is not implemented yet.',
            },
            easyFields: [],
            advancedFields: [],
          }}
          onRun={vi.fn().mockResolvedValue(undefined)}
        />
      </I18nProvider>,
    )

    expect(screen.getByText('Questa modalità non è ancora implementata.')).toBeInTheDocument()
  })
})
