// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { migrateLegacyListeningConnections } from '@/core/ops/legacy-listening-connections'
import type { SettingsRow } from '@/db/queries/settings'
import type { UserPublic } from '@/db/queries/users'

function makeSettings(overrides: Partial<SettingsRow> = {}): SettingsRow {
  return {
    id: 1,
    setupComplete: true,
    lidarrUrl: null,
    lidarrApiKey: null,
    skipTlsVerify: false,
    listenbrainzUsername: 'global-lb-user',
    listenbrainzToken: 'global-lb-token',
    lastfmUsername: 'global-lastfm-user',
    lastfmApiKey: 'global-lastfm-key',
    aiProvider: 'openai',
    aiApiKey: 'ai-key',
    aiModel: 'gpt-5.4-mini',
    aiBaseUrl: null,
    oidcIssuerUrl: null,
    oidcClientId: null,
    oidcClientSecret: null,
    oidcScopes: null,
    preferences: null,
    librarySyncIntervalHours: 6,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeUser(overrides: Partial<UserPublic> = {}): UserPublic {
  return {
    id: 1,
    username: 'admin',
    isAdmin: true,
    email: null,
    oidcSubject: null,
    authProvider: 'local',
    preferences: null,
    listenbrainzUsername: null,
    listenbrainzToken: null,
    lastfmUsername: null,
    lastfmApiKey: null,
    plexUrl: null,
    plexToken: null,
    jellyfinUrl: null,
    jellyfinApiKey: null,
    jellyfinUserId: null,
    embyUrl: null,
    embyApiKey: null,
    embyUserId: null,
    discogsToken: null,
    discogsUsername: null,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('migrateLegacyListeningConnections', () => {
  it('migrates legacy global settings into the single admin user and clears the global fields', async () => {
    const updateUserConnections = vi.fn(async () => {})
    const updateSettings = vi.fn(async () => {})
    const info = vi.fn()

    await migrateLegacyListeningConnections({
      settings: makeSettings(),
      envLegacy: {},
      users: [makeUser()],
      getUserConnections: vi.fn(async () => ({
        listenbrainzUsername: null,
        listenbrainzToken: null,
        lastfmUsername: null,
        lastfmApiKey: null,
        plexUrl: null,
        plexToken: null,
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinUserId: null,
        embyUrl: null,
        embyApiKey: null,
        embyUserId: null,
        discogsToken: null,
        discogsUsername: null,
      })),
      updateUserConnections,
      updateSettings,
      log: { info, warn: vi.fn() },
    })

    expect(updateUserConnections).toHaveBeenCalledWith(1, {
      listenbrainzUsername: 'global-lb-user',
      listenbrainzToken: 'global-lb-token',
      lastfmUsername: 'global-lastfm-user',
      lastfmApiKey: 'global-lastfm-key',
    })
    expect(updateSettings).toHaveBeenCalledWith({
      listenbrainzUsername: null,
      listenbrainzToken: null,
      lastfmUsername: null,
      lastfmApiKey: null,
    })
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Migrated legacy global listening sources to user "admin"'),
    )
  })

  it('migrates env-based legacy listening config into the only user', async () => {
    const updateUserConnections = vi.fn(async () => {})

    await migrateLegacyListeningConnections({
      settings: makeSettings({
        listenbrainzUsername: null,
        listenbrainzToken: null,
        lastfmUsername: null,
        lastfmApiKey: null,
      }),
      envLegacy: {
        listenbrainzUsername: 'env-lb-user',
        listenbrainzToken: 'env-lb-token',
      },
      users: [makeUser({ isAdmin: false, username: 'solo' })],
      getUserConnections: vi.fn(async () => ({
        listenbrainzUsername: null,
        listenbrainzToken: null,
        lastfmUsername: null,
        lastfmApiKey: null,
        plexUrl: null,
        plexToken: null,
        jellyfinUrl: null,
        jellyfinApiKey: null,
        jellyfinUserId: null,
        embyUrl: null,
        embyApiKey: null,
        embyUserId: null,
        discogsToken: null,
        discogsUsername: null,
      })),
      updateUserConnections,
      updateSettings: vi.fn(async () => {}),
      log: { info: vi.fn(), warn: vi.fn() },
    })

    expect(updateUserConnections).toHaveBeenCalledWith(1, {
      listenbrainzUsername: 'env-lb-user',
      listenbrainzToken: 'env-lb-token',
    })
  })

  it('refuses migration when multiple admins make ownership ambiguous', async () => {
    const updateUserConnections = vi.fn(async () => {})
    const updateSettings = vi.fn(async () => {})
    const warn = vi.fn()

    await migrateLegacyListeningConnections({
      settings: makeSettings(),
      envLegacy: {},
      users: [makeUser({ id: 1, username: 'alice' }), makeUser({ id: 2, username: 'bob' })],
      getUserConnections: vi.fn(async () => null),
      updateUserConnections,
      updateSettings,
      log: { info: vi.fn(), warn },
    })

    expect(updateUserConnections).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Legacy global listening sources need manual reassignment'),
    )
  })
})
