// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { dispatch } from '@/core/notifications/registry'
import type { NotificationChannel } from '@/core/notifications/types'
import type { UserPublic } from '@/db/queries/users'
import type { Preferences } from '@/db/schema'
import { resolveUserPreferences } from '@/server/helpers/preferences'

const globalChannel: NotificationChannel = {
  id: 'shared',
  type: 'webhook',
  enabled: true,
  events: ['batch_complete'],
  url: 'https://example.com/shared',
}
const personalChannel: NotificationChannel = {
  id: 'personal',
  type: 'webhook',
  enabled: true,
  events: ['request_resolved'],
  url: 'https://example.com/personal',
}
const globalPrefs: Partial<Preferences> = {
  scoreThreshold: 0.9,
  scheduleCron: '0 8 * * 1',
  autoApproveEnabled: true,
  autoApproveThreshold: 0.95,
  channels: [globalChannel],
}

function lookup(preferences: Partial<Preferences>) {
  return async () => ({ preferences }) as UserPublic
}

describe('discovery preference resolution', () => {
  it('retains global discovery settings without shared batch channels for a member with only personal channels', async () => {
    const personalPrefs = { channels: [personalChannel] }
    const resolved = await resolveUserPreferences(lookup(personalPrefs), globalPrefs, 1)
    const { channels: _channels, ...discovery } = globalPrefs
    expect(resolved).toEqual(discovery)
    expect(resolved).not.toHaveProperty('channels')
    expect(personalPrefs.channels).toEqual([personalChannel])
    const webhook = vi.fn(async () => ({ ok: true }))
    await dispatch(
      resolved?.channels,
      'batch_complete',
      {
        event: 'batch_complete',
        batchId: 1,
        stats: { discovered: 1, added: 0, failed: 0 },
        message: 'Scan complete',
        timestamp: '2026-10-18T12:00:00Z',
      },
      { senders: { webhook } },
    )
    expect(webhook).not.toHaveBeenCalled()
  })

  it('preserves member discovery overrides without shared scan channels', async () => {
    const preferences = {
      scoreThreshold: 0.7,
      netNewAlbumDiscovery: true,
      channels: [personalChannel],
    }
    const resolved = await resolveUserPreferences(lookup(preferences), globalPrefs, 1)
    expect(resolved).toEqual({
      scoreThreshold: 0.7,
      netNewAlbumDiscovery: true,
    })
    expect(resolved).not.toHaveProperty('scheduleCron')
    expect(preferences.channels).toEqual([personalChannel])
  })

  it('keeps shared scan channels for administrators', async () => {
    const admin = async () => ({ isAdmin: true, preferences: null }) as UserPublic
    expect(await resolveUserPreferences(admin, globalPrefs, 1)).toBe(globalPrefs)
  })

  it('never substitutes personal channels when shared channels are absent', async () => {
    expect(
      await resolveUserPreferences(lookup({ channels: [personalChannel] }), null, 1),
    ).toBeNull()
    expect(
      await resolveUserPreferences(
        lookup({ scoreThreshold: 0.7, channels: [personalChannel] }),
        null,
        1,
      ),
    ).toEqual({ scoreThreshold: 0.7 })
  })
})
