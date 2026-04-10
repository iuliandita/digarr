// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SubscriptionForm, type SubscriptionFormData } from '@/web/components/subscription-form'

describe('SubscriptionForm discovery mode support', () => {
  it('submits a discovery-mode subscription with mode settings', async () => {
    const onSubmit = vi.fn<[SubscriptionFormData], Promise<void>>().mockResolvedValue(undefined)

    render(
      <SubscriptionForm
        mode="create"
        configuredSources={[]}
        onCancel={vi.fn()}
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
              reason: null,
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
})
