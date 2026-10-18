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

    fireEvent.click(screen.getByText('More options'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Radar Weekly' } })
    fireEvent.change(screen.getByLabelText('Source Type'), {
      target: { value: 'discovery-mode' },
    })
    fireEvent.change(screen.getByLabelText('Discovery Mode'), {
      target: { value: 'release-radar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

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

  it.each([
    ['preset', '0 8 * * 1'],
    ['custom', '15 6 * * 2,5'],
  ])('schedules a picked mode with a %s cron and preserved settings', async (kind, cron) => {
    const onSubmit = vi.fn(async () => undefined)
    const { container } = render(
      <I18nProvider>
        <SubscriptionForm
          mode="create"
          inline
          configuredSources={[]}
          discoveryModes={discoveryModes}
          initial={{
            name: 'Release Radar',
            sourceType: 'discovery-mode',
            sourceProvider: 'release-radar',
            sourceConfig: {
              modeId: 'release-radar',
              settingsMode: 'advanced',
              settings: { seedArtists: ['Broadcast'], depth: 2 },
            },
          }}
          onCancel={() => {}}
          onSubmit={onSubmit}
        />
      </I18nProvider>,
    )

    expect(screen.queryByLabelText('Source Type')).toBeNull()
    expect(screen.queryByLabelText('Discovery Mode')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Enabled' })).toBeNull()
    expect(screen.getByLabelText('Name').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByLabelText('Max artists per run').closest('details')).toBe(
      screen.getByLabelText('Name').closest('details'),
    )
    expect(screen.getByLabelText('Scoring preset').closest('details')).toBe(
      screen.getByLabelText('Name').closest('details'),
    )
    expect(container.textContent).not.toMatch(/subscription/i)
    for (const element of container.querySelectorAll('[aria-label]')) {
      expect(element.getAttribute('aria-label')).not.toMatch(/subscription/i)
    }
    fireEvent.change(screen.getByRole('combobox', { name: 'Schedule' }), {
      target: { value: kind === 'custom' ? 'custom' : cron },
    })
    if (kind === 'custom') {
      fireEvent.change(screen.getByRole('textbox', { name: 'Custom' }), {
        target: { value: cron },
      })
    } else {
      expect(screen.queryByRole('textbox', { name: 'Custom' })).toBeNull()
    }
    expect(screen.queryByText(cron, { selector: 'code' })).toBeNull()
    if (kind === 'custom') expect(screen.queryByText(/server time/)).toBeNull()
    else expect(screen.getByText(/^Runs at 08:00( AM)? server time$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Release Radar',
          cron,
          enabled: true,
          sourceType: 'discovery-mode',
          sourceProvider: 'release-radar',
          sourceConfig: expect.objectContaining({
            modeId: 'release-radar',
            settingsMode: 'advanced',
            settings: { seedArtists: ['Broadcast'], depth: 2 },
          }),
        }),
      ),
    )
  })

  it('validates custom cron and keeps labels local to each inline editor', async () => {
    const onSubmit = vi.fn(async () => undefined)
    const { container } = render(
      <I18nProvider>
        {['First', 'Second'].map((name) => (
          <SubscriptionForm
            key={name}
            mode="create"
            inline
            configuredSources={[]}
            discoveryModes={discoveryModes}
            initial={{
              name,
              sourceType: 'discovery-mode',
              sourceConfig: { modeId: 'release-radar', settings: {} },
            }}
            onCancel={() => {}}
            onSubmit={onSubmit}
          />
        ))}
      </I18nProvider>,
    )
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = screen.getAllByLabelText('Name')
    expect(names.map((input) => (input as HTMLInputElement).value)).toEqual(['First', 'Second'])
    const scheduleSelect = screen.getAllByRole('combobox', { name: 'Schedule' })[1]
    const submitButton = screen.getAllByRole('button', { name: 'Schedule' })[1]
    if (!scheduleSelect || !submitButton) throw new Error('Missing second schedule editor')
    fireEvent.change(scheduleSelect, {
      target: { value: 'custom' },
    })
    const cron = screen.getByRole('textbox', { name: 'Custom' })
    fireEvent.change(cron, { target: { value: 'invalid' } })
    expect(cron).toBeInvalid()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid cron expression')
    fireEvent.click(submitButton)
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(cron, { target: { value: '15 6 * * 2,5' } })
    expect(cron).toBeValid()
    fireEvent.click(submitButton)
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Second', cron: '15 6 * * 2,5' }),
      ),
    )
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

    fireEvent.click(screen.getByText('More options'))
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

    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

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

    expect(screen.queryByLabelText('Source Type')).toBeNull()
    expect(screen.queryByLabelText('Discovery Mode')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Enabled' })).toBeNull()
    expect(screen.getByLabelText('Schedule')).toHaveValue('0 8 * * 0')
    expect(screen.getByLabelText('Name').closest('details')).not.toHaveAttribute('open')

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
