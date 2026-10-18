// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateSubscriptionSchema } from '@/server/schemas/subscriptions'
import {
  buildSubscriptionUpdate,
  SubscriptionForm,
  type SubscriptionFormData,
} from '@/web/components/subscription-form'
import type { DiscoveryModeResponse } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

function renderForm(props: Partial<ComponentProps<typeof SubscriptionForm>> = {}) {
  const onSubmit = vi.fn(async (_data: SubscriptionFormData) => undefined)
  const element = (extra: Partial<ComponentProps<typeof SubscriptionForm>> = {}) => (
    <I18nProvider>
      <SubscriptionForm
        mode="create"
        configuredSources={[]}
        onCancel={() => {}}
        onSubmit={onSubmit}
        {...props}
        {...extra}
      />
    </I18nProvider>
  )
  const utils = render(element())
  return {
    onSubmit,
    rerenderWith: (extra: Partial<ComponentProps<typeof SubscriptionForm>>) =>
      utils.rerender(element(extra)),
  }
}

describe('SubscriptionForm edit payload and providers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it.each([
    ['genre', { genre: 'shoegaze', providers: ['lastfm'] }],
    ['similar', { seedArtists: [{ name: 'Slowdive' }], providers: ['lastfm'] }],
    ['lastfm-tag', { tag: 'dreampop' }],
  ])(
    'builds a %s edit payload the strict PATCH schema accepts',
    async (sourceType, sourceConfig) => {
      const { onSubmit } = renderForm({
        mode: 'edit',
        configuredSources: ['lastfm'],
        initial: {
          name: 'Weekly',
          sourceType,
          sourceProvider: 'lastfm',
          sourceConfig,
          cron: '0 8 * * 0',
          enabled: true,
          maxArtistsPerRun: 20,
          action: 'add_to_recommendations',
          scoreThreshold: null,
          scoringWeightPreset: 'default',
        },
      })

      fireEvent.click(screen.getByText('More options'))
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated weekly' } })
      fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: 'custom' } })
      fireEvent.change(screen.getByLabelText('Custom'), { target: { value: '30 7 * * 2' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      const data = onSubmit.mock.calls[0]?.[0] as SubscriptionFormData
      const parsed = updateSubscriptionSchema.safeParse(buildSubscriptionUpdate(data))
      expect(parsed.success).toBe(true)
      expect(parsed.data).toMatchObject({ name: 'Updated weekly', cron: '30 7 * * 2' })
      expect(parsed.data?.sourceConfig).toEqual(expect.objectContaining(sourceConfig))
    },
  )

  it('locks the source type while editing', () => {
    renderForm({
      mode: 'edit',
      initial: { name: 'Weekly', sourceType: 'genre', sourceConfig: { genre: 'jazz' } },
    })
    expect(screen.getByLabelText('Source Type')).toBeDisabled()
  })

  it('offers genre providers and seeds them once settings load', async () => {
    const { onSubmit, rerenderWith } = renderForm()
    expect(screen.getByRole('button', { name: /Last\.fm/ })).toBeDisabled()

    rerenderWith({ configuredSources: ['lastfm', 'discogs'] })

    expect(screen.getByRole('button', { name: 'Last.fm' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Discogs' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Discogs' }))
    fireEvent.click(screen.getByText('More options'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jazz Weekly' } })
    fireEvent.change(screen.getByLabelText('Genre'), { target: { value: 'jazz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ sourceConfig: { genre: 'jazz', providers: ['lastfm'] } }),
      ),
    )
  })

  it('restores saved Tag Radio tags when editing', () => {
    const tagRadio = {
      id: 'tag-radio',
      label: 'Tag Radio',
      description: 'Tags',
      availability: { enabled: true, fallbackUsed: false, providerPath: ['listenbrainz'] },
      easyFields: [{ key: 'tags', label: 'Tags', type: 'tags', required: true }],
      advancedFields: [{ key: 'tags', label: 'Tags', type: 'tags', required: true }],
    } as DiscoveryModeResponse
    renderForm({
      mode: 'edit',
      discoveryModes: [tagRadio],
      initial: {
        name: 'Tags',
        sourceType: 'discovery-mode',
        sourceConfig: {
          modeId: 'tag-radio',
          settingsMode: 'easy',
          settings: { tags: [{ tag: 'shoegaze', weight: 1 }] },
        },
      },
    })

    expect(screen.getByDisplayValue('shoegaze')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('[object Object]')).toBeNull()
  })
})
