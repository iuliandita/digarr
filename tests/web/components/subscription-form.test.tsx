// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SubscriptionForm } from '@/web/components/subscription-form'
import type { DiscoveryModeResponse } from '@/web/lib/api'

describe('SubscriptionForm discovery mode support', () => {
  it('submits a discovery-mode subscription with mode settings', async () => {
    const onSubmit = vi.fn(async () => undefined)

    render(
      <SubscriptionForm
        mode="create"
        configuredSources={[]}
        onCancel={() => {}}
        onSubmit={onSubmit}
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
      />,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Radar Weekly' } })
    fireEvent.change(screen.getByLabelText('Source Type'), {
      target: { value: 'discovery-mode' },
    })
    fireEvent.change(screen.getByLabelText('Discovery Mode'), {
      target: { value: 'release-radar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    const depthInput = screen.getAllByRole('spinbutton')[0]
    if (!depthInput) {
      throw new Error('Missing depth input')
    }
    fireEvent.change(depthInput, { target: { value: '2' } })
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
          }),
        }),
      )
    })
  })

  it('preserves an existing advanced discovery-mode subscription when editing', async () => {
    const onSubmit = vi.fn(async () => undefined)
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

    render(
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
      />,
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
          },
        }),
      )
    })
  })
})
