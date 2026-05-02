// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionForm } from '@/web/components/subscription-form'
import type { DiscoveryModeResponse } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

describe('SubscriptionForm discovery mode support', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value)
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key)
        }),
      },
    })
  })
  const discoveryModes: DiscoveryModeResponse[] = [
    {
      id: 'release-radar',
      label: 'Release Radar',
      description: 'Find fresh releases through the release radar mode.',
      availability: {
        enabled: true,
        fallbackUsed: false,
        providerPath: ['musicbrainz'],
        reason: undefined,
      },
      easyFields: [
        {
          key: 'seedArtists',
          label: 'Seed artists',
          type: 'multiselect',
          required: false,
        },
      ],
      advancedFields: [
        {
          key: 'seedArtists',
          label: 'Seed artists',
          type: 'multiselect',
          required: false,
        },
        {
          key: 'depth',
          label: 'Depth',
          type: 'number',
          required: false,
        },
      ],
    },
  ]

  it('submits a discovery-mode subscription with mode settings', async () => {
    const onSubmit = vi.fn(async () => undefined)

    render(
      <I18nProvider>
        <SubscriptionForm
          mode="create"
          configuredSources={[]}
          onCancel={() => {}}
          onSubmit={onSubmit}
          discoveryModes={discoveryModes}
        />
      </I18nProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Radar Weekly' } })
    fireEvent.change(screen.getByLabelText('Source Type'), {
      target: { value: 'discovery-mode' },
    })
    fireEvent.change(screen.getByLabelText('Discovery Mode'), {
      target: { value: 'release-radar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: 'discovery-mode',
          sourceProvider: 'release-radar',
          sourceConfig: expect.objectContaining({
            modeId: 'release-radar',
            settingsMode: 'advanced',
            settings: expect.objectContaining({
              seedArtists: [],
              depth: 2,
            }),
            providerContext: { providerPath: ['musicbrainz'] },
            fallbackPolicy: 'strict',
          }),
        }),
      )
    })
  })

  it('hydrates discovery-mode state when modes load after switching source type', async () => {
    const onSubmit = vi.fn(async () => undefined)
    const { rerender } = render(
      <I18nProvider>
        <SubscriptionForm
          mode="create"
          configuredSources={[]}
          onCancel={() => {}}
          onSubmit={onSubmit}
          discoveryModes={[]}
        />
      </I18nProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Radar Weekly' } })
    fireEvent.change(screen.getByLabelText('Source Type'), {
      target: { value: 'discovery-mode' },
    })

    rerender(
      <I18nProvider>
        <SubscriptionForm
          mode="create"
          configuredSources={[]}
          onCancel={() => {}}
          onSubmit={onSubmit}
          discoveryModes={discoveryModes}
        />
      </I18nProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Discovery Mode')).toHaveValue('release-radar')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: 'discovery-mode',
          sourceProvider: 'release-radar',
          sourceConfig: expect.objectContaining({
            modeId: 'release-radar',
            settingsMode: 'easy',
            settings: {
              seedArtists: [],
            },
            providerContext: { providerPath: ['musicbrainz'] },
            fallbackPolicy: 'strict',
          }),
        }),
      )
    })
  })

  it('renders translated chrome for italian locale', () => {
    localStorage.setItem('digarr-locale', 'it')

    render(
      <I18nProvider>
        <SubscriptionForm
          mode="create"
          configuredSources={[]}
          onCancel={() => {}}
          onSubmit={vi.fn(async () => undefined)}
          discoveryModes={discoveryModes}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('dialog', { name: 'Crea abbonamento' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
    expect(screen.getByLabelText('Tipo di sorgente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crea' })).toBeInTheDocument()
  })

  it('preserves an existing advanced discovery-mode subscription when editing', async () => {
    const onSubmit = vi.fn(async () => undefined)

    render(
      <I18nProvider>
        <SubscriptionForm
          mode="edit"
          configuredSources={[]}
          onCancel={() => {}}
          onSubmit={onSubmit}
          initial={{
            name: 'Radar Weekly',
            sourceType: 'discovery-mode',
            sourceProvider: 'release-radar',
            sourceConfig: {
              modeId: 'release-radar',
              settingsMode: 'advanced',
              settings: { seedArtists: ['Broadcast'], depth: 2 },
            },
            cron: '0 8 * * 0',
            enabled: true,
            maxArtistsPerRun: 20,
            action: 'add_to_recommendations',
            scoreThreshold: null,
            scoringWeightPreset: 'genre',
          }}
          discoveryModes={discoveryModes}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: 'discovery-mode',
          sourceProvider: 'release-radar',
          sourceConfig: {
            modeId: 'release-radar',
            settingsMode: 'advanced',
            settings: { seedArtists: ['Broadcast'], depth: 2 },
            providerContext: { providerPath: ['musicbrainz'] },
            fallbackPolicy: 'strict',
          },
        }),
      )
    })
  })

  it('keeps a missing saved discovery mode unchanged when editing', async () => {
    const onSubmit = vi.fn(async () => undefined)

    const initial = {
      name: 'Radar Weekly',
      sourceType: 'discovery-mode',
      sourceProvider: 'release-radar',
      sourceConfig: {
        modeId: 'release-radar',
        settingsMode: 'advanced',
        settings: { seedArtists: ['Broadcast'], depth: 2 },
      },
      cron: '0 8 * * 0',
      enabled: true,
      maxArtistsPerRun: 20,
      action: 'add_to_recommendations',
      scoreThreshold: null,
      scoringWeightPreset: 'genre',
    }

    const { rerender } = render(
      <I18nProvider>
        <SubscriptionForm
          mode="edit"
          configuredSources={[]}
          onCancel={() => {}}
          onSubmit={onSubmit}
          initial={initial}
          discoveryModes={[]}
        />
      </I18nProvider>,
    )

    rerender(
      <I18nProvider>
        <SubscriptionForm
          mode="edit"
          configuredSources={[]}
          onCancel={() => {}}
          onSubmit={onSubmit}
          initial={initial}
          discoveryModes={[
            {
              id: 'new-mode',
              label: 'New Mode',
              description: 'Replacement discovery mode.',
              availability: {
                enabled: true,
                fallbackUsed: false,
                providerPath: ['musicbrainz'],
                reason: undefined,
              },
              easyFields: [],
              advancedFields: [],
            },
          ]}
        />
      </I18nProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText(/select a discovery mode to configure it/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: 'discovery-mode',
          sourceProvider: 'release-radar',
          sourceConfig: {
            modeId: 'release-radar',
            settingsMode: 'advanced',
            settings: { seedArtists: ['Broadcast'], depth: 2 },
          },
        }),
      )
    })
  })

  it('preserves legacy discovery-mode settings keys when editing', async () => {
    const onSubmit = vi.fn(async () => undefined)

    render(
      <I18nProvider>
        <SubscriptionForm
          mode="edit"
          configuredSources={[]}
          onCancel={() => {}}
          onSubmit={onSubmit}
          initial={{
            name: 'Radar Weekly',
            sourceType: 'discovery-mode',
            sourceProvider: 'release-radar',
            sourceConfig: {
              modeId: 'release-radar',
              settingsMode: 'advanced',
              settings: {
                seedArtists: ['Broadcast'],
                depth: 2,
                legacyToggle: true,
              },
            },
            cron: '0 8 * * 0',
            enabled: true,
            maxArtistsPerRun: 20,
            action: 'add_to_recommendations',
            scoreThreshold: null,
            scoringWeightPreset: 'genre',
          }}
          discoveryModes={[
            {
              id: 'release-radar',
              label: 'Release Radar',
              description: 'Find fresh releases through the release radar mode.',
              availability: {
                enabled: true,
                fallbackUsed: false,
                providerPath: ['musicbrainz'],
                reason: undefined,
              },
              easyFields: [
                {
                  key: 'seedArtists',
                  label: 'Seed artists',
                  type: 'multiselect',
                  required: false,
                },
              ],
              advancedFields: [
                {
                  key: 'seedArtists',
                  label: 'Seed artists',
                  type: 'multiselect',
                  required: false,
                },
                {
                  key: 'depth',
                  label: 'Depth',
                  type: 'number',
                  required: false,
                },
              ],
            },
          ]}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: 'discovery-mode',
          sourceProvider: 'release-radar',
          sourceConfig: {
            modeId: 'release-radar',
            settingsMode: 'advanced',
            settings: {
              seedArtists: ['Broadcast'],
              depth: 2,
              legacyToggle: true,
            },
            providerContext: { providerPath: ['musicbrainz'] },
            fallbackPolicy: 'strict',
          },
        }),
      )
    })
  })
})
