// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveSubscriptionSourceConnections } from '@/core/subscriptions/connections'
import type { SettingsRow } from '@/db/queries/settings'
import type { UserConnections } from '@/db/queries/users'

function makeSettings(overrides: Partial<SettingsRow> = {}): SettingsRow {
  return {
    id: 1,
    setupComplete: true,
    lidarrUrl: null,
    lidarrApiKey: null,
    skipTlsVerify: false,
    audiodbApiKey: null,
    audiodbProxyImages: false,
    wikidataEnabled: true,
    listenbrainzUsername: 'global-lb-user',
    listenbrainzToken: 'global-lb-token',
    lastfmUsername: 'global-lastfm-user',
    lastfmApiKey: 'global-lastfm-key',
    aiProvider: null,
    aiApiKey: null,
    aiModel: null,
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

function makeUserConnections(overrides: Partial<UserConnections> = {}): UserConnections {
  return {
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
    ...overrides,
  }
}

describe('resolveSubscriptionSourceConnections', () => {
  it('uses only user-scoped credentials when the user has source credentials', () => {
    const resolved = resolveSubscriptionSourceConnections(makeSettings(), makeUserConnections())

    expect(resolved).toEqual({
      lbUsername: null,
      lbToken: null,
      lfUsername: null,
      lfApiKey: null,
    })
  })

  it('ignores global settings and resolves only user credentials', () => {
    const resolved = resolveSubscriptionSourceConnections(
      makeSettings(),
      makeUserConnections({
        listenbrainzUsername: 'user-lb',
        listenbrainzToken: 'user-lb-token',
        lastfmUsername: 'user-lastfm',
        lastfmApiKey: 'user-lastfm-key',
      }),
    )

    expect(resolved).toEqual({
      lbUsername: 'user-lb',
      lbToken: 'user-lb-token',
      lfUsername: 'user-lastfm',
      lfApiKey: 'user-lastfm-key',
    })
  })
})
