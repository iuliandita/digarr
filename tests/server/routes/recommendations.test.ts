// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsRow } from '@/db/queries/settings'
import type { AppDependencies } from '@/server'
import { createApp } from '@/server'
import { makeDeps as makeSharedDeps } from '../../helpers/test-app'

// Hoist the mock so vitest can resolve it before imports
vi.mock('@/core/clients/lidarr', () => ({
  createLidarrClient: vi.fn(),
}))

vi.mock('@/core/provider-auth', () => ({
  resolveProviderToken: vi.fn(async () => 'spotify-token'),
}))

vi.mock('@/core/clients/spotify', () => ({
  createSpotifyClient: vi.fn(),
}))

vi.mock('@/core/clients/lastfm', () => ({
  createLastFmClient: vi.fn(),
}))

vi.mock('@/db/queries/playlists', () => ({
  getOwnedAuditionTrack: vi.fn(async () => null),
  getPendingPlayability: vi.fn(),
}))

vi.mock('@/db/queries/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/queries/users')>()),
  getUserConnections: vi.fn(async () => null),
}))

vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => ({
    getReleaseGroups: vi.fn(async () => [
      { id: 'rg-dummy', title: 'Dummy', type: 'Album', firstReleaseDate: '1994-08-22' },
      { id: 'rg-portishead', title: 'Portishead', type: 'Album', firstReleaseDate: '1997-09-29' },
      { id: 'rg-third', title: 'Third', type: 'Album', firstReleaseDate: '2008-04-28' },
    ]),
  })),
}))

// Mock sessions so auth middleware sets userId
vi.mock('@/core/sessions', () => ({
  getSession: vi.fn(async () => ({
    userId: 1,
    token: 'test-token',
    expiresAt: new Date(Date.now() + 86400000),
  })),
  setSessionStore: vi.fn(),
}))

import { createLastFmClient } from '@/core/clients/lastfm'
import { createLidarrClient } from '@/core/clients/lidarr'
import { createSpotifyClient } from '@/core/clients/spotify'
import { getOwnedAuditionTrack, getPendingPlayability } from '@/db/queries/playlists'
import { getUserConnections } from '@/db/queries/users'

const mockArtist = {
  id: 10,
  mbid: 'mbid-abc-123',
  name: 'Test Artist',
  disambiguation: null,
  tags: null,
  genres: null,
  imageUrl: null,
  logoUrl: null,
  streamingUrls: null,
  imageFailedAt: null,
  cachedAt: new Date('2024-01-01'),
  genresCachedAt: null,
  beginYear: null,
  endYear: null,
  topTracks: null,
  description: null,
  externalLinks: null,
  wikidataId: null,
  wikidataFetchedAt: null,
  wikidataFailedAt: null,
}

const mockRecommendation = {
  id: 1,
  userId: 1 as number | null,
  artistId: 10,
  batchId: 1,
  score: 0.85,
  status: 'pending',
  kind: 'artist',
  sources: null,
  aiReasoning: null,
  reasons: [],
  lidarrArtistId: null,
  lidarrError: null,
  recommendedReleaseGroupId: null,
  recommendedReleaseGroupTitle: null,
  targetActions: null,
  rejectionReason: null,
  rejectionReasonText: null,
  actedOnAt: null,
  createdAt: new Date('2024-01-01'),
  artist: mockArtist,
}

function makeDeps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return makeSharedDeps({
    storeDb: {} as unknown as AppDependencies['storeDb'],
    scheduler: {} as AppDependencies['scheduler'],
    providerRegistry: {} as unknown as AppDependencies['providerRegistry'],
    getSettings: vi.fn(
      async () =>
        ({
          id: 1,
          lidarrUrl: 'http://lidarr:8686',
          lidarrApiKey: 'key',
          preferences: { qualityProfileId: 1, rootFolderId: 1 },
        }) as SettingsRow,
    ),
    listRecommendations: vi.fn(async () => ({ items: [mockRecommendation], total: 1 })),
    getRecommendation: vi.fn(async (id: number) => (id === 1 ? mockRecommendation : null)),
    getUserById: vi.fn(async () => null),
    getUserCount: vi.fn(async () => 0),
    ...overrides,
  }) as AppDependencies
}

async function authedRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      Authorization: 'Bearer test-token',
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  })
}

const mockLidarrClient = {
  getTags: vi.fn(async () => []),
  createTag: vi.fn(async (label: string) => ({ id: 1, label })),
  getCommand: vi.fn(async () => ({ id: 0, name: '', status: '' })),
  getManualImport: vi.fn(async () => []),
  updateManualImport: vi.fn(async () => []),
  manualImport: vi.fn(async () => ({ id: 0, name: '', status: '' })),
  getTracks: vi.fn(async () => []),
  addArtist: vi.fn(),
  getQualityProfiles: vi.fn(async () => []),
  getMetadataProfiles: vi.fn(async () => []),
  getRootFolders: vi.fn(async () => []),
  getArtists: vi.fn(async () => []),
  findArtistByMbid: vi.fn(async () => null),
  lookupArtist: vi.fn(async () => []),
  getAlbums: vi.fn(async () => []),
  getWantedMissing: vi.fn(async () => []),
  setArtistsMonitored: vi.fn(async () => []),
  setAlbumsMonitored: vi.fn(async () => []),
  triggerCommand: vi.fn(async () => ({ id: 0, name: '', status: '' })),
  canListPath: vi.fn(async () => true),
  testConnection: vi.fn(async () => ({ success: true, message: 'ok' })),
}

beforeEach(() => {
  vi.mocked(createLidarrClient).mockReturnValue(
    mockLidarrClient as ReturnType<typeof createLidarrClient>,
  )
  vi.clearAllMocks()
  vi.mocked(createLidarrClient).mockReturnValue(
    mockLidarrClient as ReturnType<typeof createLidarrClient>,
  )
})

describe('GET /api/v1/recommendations', () => {
  it('returns list and total', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe(1)
  })

  it('passes filters to listRecommendations', async () => {
    const listRecommendations = vi.fn(async () => ({ items: [], total: 0 }))
    const app = createApp(makeDeps({ listRecommendations }))
    const res = await authedRequest(app, '/api/v1/recommendations?status=pending&limit=5&offset=10')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ items: [], total: 0 })
    expect(listRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', limit: 5, offset: 10 }),
    )
  })

  it('uses only the authenticated user genre priorities for taste ordering', async () => {
    const listRecommendations = vi.fn(async () => ({ items: [], total: 0 }))
    const getUserById = vi.fn(async () => ({
      id: 1,
      preferences: {
        primaryGenres: ['metal', 'jazz', 'trip hop'],
        secondaryGenres: ['ambient'],
      },
    })) as unknown as AppDependencies['getUserById']
    const app = createApp(makeDeps({ listRecommendations, getUserById }))
    const res = await authedRequest(
      app,
      '/api/v1/recommendations?sort=taste&tasteTier=secondary&primaryGenres=pop&userId=2',
    )
    expect(res.status).toBe(200)
    expect(getUserById).toHaveBeenCalledWith(1)
    expect(listRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        sort: 'taste',
        tasteTier: 'secondary',
        primaryGenres: ['metal', 'jazz', 'trip hop'],
        secondaryGenres: ['ambient'],
      }),
    )
  })

  it('returns 400 for an invalid batchId filter', async () => {
    const listRecommendations = vi.fn(async () => ({ items: [], total: 0 }))
    const app = createApp(makeDeps({ listRecommendations }))
    const res = await authedRequest(app, '/api/v1/recommendations?batchId=not-a-number')

    expect(res.status).toBe(400)
    expect(listRecommendations).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/recommendations/:id', () => {
  it('returns 200 with recommendation when found', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations/1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(1)
    expect(body.artist.mbid).toBe('mbid-abc-123')
  })

  it('returns 404 when not found', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations/999')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/recommendations/:id', () => {
  it.each([
    [{ status: 'approved' }, false],
    [{ status: 'rejected', permanent: true }, false],
    [
      { status: 'approved', feedbackTrack: { artistName: 'Other artist', trackName: 'A song' } },
      false,
    ],
    [
      {
        status: 'approved',
        feedbackTrack: {
          artistName: 'Test Artist',
          trackName: 'Exact song',
          recordingMbid: 'df523108-2308-4bb5-8972-7185bcbbbd45',
        },
      },
      true,
    ],
  ] as const)(
    'dispatches track feedback only for exact successful approval %j',
    async (body, sends) => {
      const approvedTrack = vi.fn(async () => {})
      const deps = makeDeps({
        scrobblerWriteBack: { approvedTrack, generatedPlaylist: vi.fn(async () => {}) },
      })
      const res = await authedRequest(createApp(deps), '/api/v1/recommendations/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(200)
      expect(approvedTrack).toHaveBeenCalledTimes(sends ? 1 : 0)
      if (sends) {
        expect(approvedTrack).toHaveBeenCalledWith(1, body.feedbackTrack)
        expect(deps.updateRecommendationStatus).toHaveBeenCalledBefore(approvedTrack)
      }
    },
  )

  it('finishes approval while write-back remains pending and survives its rejection', async () => {
    let reject!: (error: Error) => void
    const delivery = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const approvedTrack = vi.fn(() => delivery)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createApp(
      makeDeps({ scrobblerWriteBack: { approvedTrack, generatedPlaylist: vi.fn() } }),
    )
    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        feedbackTrack: { artistName: 'Test Artist', trackName: 'Exact song' },
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'approved' })
    reject(new Error('provider-secret'))
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith('[write-back] Could not dispatch approved track'),
    )
    expect(log.mock.calls.flat().join(' ')).not.toContain('provider-secret')
    log.mockRestore()
  })

  it.each([
    null,
    { artistName: 'Other artist', trackName: 'Exact song', recordingMbid: null },
    { artistName: 'Test Artist', trackName: '   ', recordingMbid: null },
    {
      artistName: 'Test Artist',
      trackName: 'Exact song',
      recordingMbid: 'df523108-2308-4bb5-8972-7185bcbbbd45',
    },
  ])('uses only an owned Audition track matching the recommendation: %j', async (track) => {
    vi.mocked(getOwnedAuditionTrack).mockResolvedValueOnce(track)
    const approvedTrack = vi.fn(async () => {})
    const deps = makeDeps({ scrobblerWriteBack: { approvedTrack, generatedPlaylist: vi.fn() } })
    const res = await authedRequest(createApp(deps), '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', auditionTrackId: 123 }),
    })
    expect(getOwnedAuditionTrack).toHaveBeenCalledWith(deps.db, 1, 123, mockArtist.mbid)
    const valid = track?.artistName === 'Test Artist' && Boolean(track.trackName.trim())
    expect(res.status).toBe(200)
    expect(approvedTrack).toHaveBeenCalledTimes(valid ? 1 : 0)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledTimes(1)
  })
  it('approves a stale Audition track without write-back configured', async () => {
    const deps = makeDeps()
    const res = await authedRequest(createApp(deps), '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', auditionTrackId: 123 }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'approved' })
    expect(deps.updateRecommendationStatus).toHaveBeenCalledTimes(1)
  })

  it('approves without feedback when the Audition lookup fails', async () => {
    vi.mocked(getOwnedAuditionTrack).mockRejectedValueOnce(new Error('database-private-detail'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const approvedTrack = vi.fn(async () => {})
    const deps = makeDeps({ scrobblerWriteBack: { approvedTrack, generatedPlaylist: vi.fn() } })
    const res = await authedRequest(createApp(deps), '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', auditionTrackId: 123 }),
    })
    expect(res.status).toBe(200)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledTimes(1)
    expect(approvedTrack).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('[write-back] Could not resolve approved Audition track')
    expect(log.mock.calls.flat().join(' ')).not.toContain('database-private-detail')
    log.mockRestore()
  })

  it('updates to rejected status without calling Lidarr', async () => {
    const rejectRecommendation = vi.fn(async () => ({ artistId: 1, blockCreated: false }))
    const app = createApp(makeDeps({ rejectRecommendation }))
    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'rejected', blockCreated: false })
    expect(rejectRecommendation).toHaveBeenCalledWith({
      recommendationId: 1,
      userId: expect.any(Number),
      reason: null,
      reasonText: null,
      permanent: false,
    })
  })

  it('persists structured reason + permanent block when supplied', async () => {
    const rejectRecommendation = vi.fn(async () => ({ artistId: 1, blockCreated: false }))
    const app = createApp(makeDeps({ rejectRecommendation }))
    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        reason: 'tried_didnt_like',
        permanent: true,
      }),
    })
    expect(res.status).toBe(200)
    expect(rejectRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'tried_didnt_like',
        permanent: true,
      }),
    )
  })

  it('returns 400 when reason=not_right_now combined with permanent=true', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        reason: 'not_right_now',
        permanent: true,
      }),
    })
    expect(res.status).toBe(400)
  })

  it('approve triggers target add and sets added_to_lidarr on success', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    const mockTarget = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 99,
      }),
    }

    const app = createApp(
      makeDeps({
        updateRecommendationStatus,
        getUserCount: vi.fn(async () => 1),
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([mockTarget]),
      }),
    )
    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('added_to_lidarr')
    expect(mockTarget.addArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-abc-123', name: 'Test Artist' },
      expect.objectContaining({ monitorOption: 'none' }),
    )
    expect(updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.objectContaining({ lidarrArtistId: 99 }),
    )
  })

  it('approves album-kind recs via addAlbum capability', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    const albumRec = {
      ...mockRecommendation,
      kind: 'album',
      recommendedReleaseGroupId: 'rg-1',
      artist: { ...mockArtist, mbid: 'a1', name: 'Artist' },
    }
    const addAlbum = vi.fn().mockResolvedValue({
      success: true,
      targetType: 'lidarr',
      targetId: 'lidarr-1',
      externalId: 7,
    })
    const addArtist = vi.fn()
    const mockTarget = {
      id: 'lidarr-1',
      name: 'Lidarr',
      type: 'lidarr',
      capabilities: ['addArtist', 'addAlbum'],
      addAlbum,
      addArtist,
      testConnection: vi.fn(),
    }

    const app = createApp(
      makeDeps({
        updateRecommendationStatus,
        getRecommendation: vi.fn(async (id: number) => (id === 1 ? albumRec : null)),
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([mockTarget]),
      }),
    )
    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('added_to_lidarr')
    expect(addAlbum).toHaveBeenCalledTimes(1)
    expect(addAlbum).toHaveBeenCalledWith(
      { artistMbid: 'a1', artistName: 'Artist', releaseGroupMbid: 'rg-1' },
      expect.any(Object),
    )
    expect(addArtist).not.toHaveBeenCalled()
    expect(updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.any(Object),
    )
    // The album external id (7) must NOT leak into lidarrArtistId, which is an
    // artist-scoped column. The album id is retained in targetActions instead.
    const albumExtra = (updateRecommendationStatus.mock.calls[0] as unknown[])?.[2] as
      | Record<string, unknown>
      | undefined
    expect(albumExtra).not.toHaveProperty('lidarrArtistId')
    expect(body).not.toHaveProperty('lidarrArtistId')
  })

  it('approve sets add_failed when target fails', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    const mockTarget = {
      id: 'lidarr-1',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: false,
        targetType: 'lidarr',
        targetId: 1,
        error: 'Lidarr down',
      }),
    }

    const app = createApp(
      makeDeps({
        updateRecommendationStatus,
        getUserCount: vi.fn(async () => 1),
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([mockTarget]),
      }),
    )
    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('add_failed')
    expect(body.lidarrError).toMatch(/lidarr down/i)
    expect(updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'add_failed',
      expect.objectContaining({ lidarrError: expect.any(String) }),
    )
  })

  it('returns 400 when status is missing', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for approve when recommendation not found', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(404)
  })

  it('passes per-request profile overrides to target addArtist', async () => {
    const mockAddArtist = vi.fn().mockResolvedValue({
      success: true,
      targetType: 'lidarr',
      targetId: 1,
      externalId: 99,
    })
    const mockTarget = {
      id: 'lidarr-1',
      name: 'Lidarr',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: mockAddArtist,
      testConnection: vi.fn(),
    }

    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([mockTarget]),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({
        status: 'approved',
        qualityProfileId: 5,
        metadataProfileId: 3,
        rootFolderId: 2,
      }),
    })

    expect(res.status).toBe(200)
    expect(mockAddArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-abc-123', name: 'Test Artist' },
      expect.objectContaining({
        qualityProfileId: 5,
        metadataProfileId: 3,
        rootFolderId: 2,
      }),
    )
  })

  it('resolves popular albums to selected release groups before approving', async () => {
    vi.mocked(createSpotifyClient).mockReturnValue({
      findExactArtistByName: vi.fn(async () => ({ id: 'sp-artist', name: 'Test Artist' })),
      getPopularAlbumsForArtist: vi.fn(async () => [
        { id: 'sp-third', title: 'Third', releaseDate: '2008-04-28', popularity: 82 },
        { id: 'sp-dummy', title: 'Dummy', releaseDate: '1994-08-22', popularity: 78 },
        { id: 'sp-portishead', title: 'Portishead', releaseDate: '1997-09-29', popularity: 75 },
      ]),
    } as unknown as ReturnType<typeof createSpotifyClient>)

    const mockAddArtist = vi.fn().mockResolvedValue({
      success: true,
      targetType: 'lidarr',
      targetId: 1,
      externalId: 99,
    })
    const mockTarget = {
      id: 'lidarr-1',
      name: 'Lidarr',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: mockAddArtist,
      testConnection: vi.fn(),
    }

    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([mockTarget]),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved', monitorOption: 'popular' }),
    })

    expect(res.status).toBe(200)
    expect(mockAddArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-abc-123', name: 'Test Artist' },
      expect.objectContaining({
        monitorOption: 'selected',
        selectedAlbumIds: ['rg-third', 'rg-dummy', 'rg-portishead'],
      }),
    )
  })

  it('falls back to Last.fm top albums when Spotify returns none', async () => {
    vi.mocked(createSpotifyClient).mockReturnValue({
      findExactArtistByName: vi.fn(async () => null),
      getPopularAlbumsForArtist: vi.fn(async () => []),
    } as unknown as ReturnType<typeof createSpotifyClient>)
    vi.mocked(getUserConnections).mockResolvedValueOnce({
      lastfmUsername: 'listener',
      lastfmApiKey: 'lfm-key',
    } as Awaited<ReturnType<typeof getUserConnections>>)
    vi.mocked(createLastFmClient).mockReturnValue({
      getTopAlbumsForArtist: vi.fn(async () => [
        { title: 'Third', popularity: 50000, mbid: 'lfm-third' },
        { title: 'Dummy', popularity: 42000, mbid: 'lfm-dummy' },
      ]),
    } as unknown as ReturnType<typeof createLastFmClient>)

    const mockAddArtist = vi.fn().mockResolvedValue({
      success: true,
      targetType: 'lidarr',
      targetId: 1,
      externalId: 99,
    })
    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([
          {
            id: 'lidarr-1',
            name: 'Lidarr',
            type: 'lidarr',
            capabilities: ['addArtist'],
            addArtist: mockAddArtist,
            testConnection: vi.fn(),
          },
        ]),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved', monitorOption: 'popular' }),
    })

    expect(res.status).toBe(200)
    expect(mockAddArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-abc-123', name: 'Test Artist' },
      expect.objectContaining({
        monitorOption: 'selected',
        selectedAlbumIds: ['rg-third', 'rg-dummy'],
      }),
    )
  })

  it('returns 400 with code no_source when no popularity source has albums', async () => {
    vi.mocked(createSpotifyClient).mockReturnValue({
      findExactArtistByName: vi.fn(async () => null),
      getPopularAlbumsForArtist: vi.fn(async () => []),
    } as unknown as ReturnType<typeof createSpotifyClient>)
    vi.mocked(getUserConnections).mockResolvedValueOnce(null)

    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([
          {
            id: 'lidarr-1',
            name: 'Lidarr',
            type: 'lidarr',
            capabilities: ['addArtist'],
            addArtist: vi.fn(),
            testConnection: vi.fn(),
          },
        ]),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved', monitorOption: 'popular' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'no_source' })
  })

  it('returns 400 when targetId does not match an enabled target', async () => {
    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([
          {
            id: 'lidarr-1',
            name: 'Lidarr',
            type: 'lidarr',
            capabilities: ['addArtist'],
            addArtist: vi.fn(),
          },
        ]),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved', targetId: 'missing-target' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      type: '/problems/http-400',
      title: 'Bad Request',
      status: 400,
      detail: 'Unknown targetId: missing-target',
      error: 'Unknown targetId: missing-target',
    })
  })

  it('supports combined lidarr + slskd approval ordering', async () => {
    const updateRecommendationStatus = vi.fn(async () => {})
    const mockLidarrTarget = {
      id: 'lidarr-1',
      name: 'Lidarr',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 77,
      }),
      testConnection: vi.fn(),
    }
    const mockSlskdTarget = {
      id: 'slskd-7',
      name: 'slskd',
      type: 'slskd',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'slskd',
        targetId: 7,
      }),
      testConnection: vi.fn(),
    }

    const app = createApp(
      makeDeps({
        updateRecommendationStatus,
        getEnabledTargetsForUser: vi
          .fn()
          .mockResolvedValue([mockLidarrTarget, mockSlskdTarget] as never),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({
        status: 'approved',
        approvalMode: 'combined_lidarr_slskd',
        targetId: 'slskd-7',
      }),
    })

    expect(res.status).toBe(200)
    expect(mockLidarrTarget.addArtist).toHaveBeenCalledBefore(mockSlskdTarget.addArtist as never)
    expect(mockSlskdTarget.addArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-abc-123', name: 'Test Artist' },
      expect.objectContaining({
        userId: 1,
        recommendationId: 1,
        lidarrArtistId: 77,
      }),
    )
    expect(updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.objectContaining({
        targetActions: expect.objectContaining({
          'lidarr-1': expect.any(Object),
          'slskd-7': expect.any(Object),
        }),
      }),
    )
  })

  it('uses the requested Lidarr target for combined approval when multiple Lidarr targets exist', async () => {
    const firstLidarrTarget = {
      id: 'lidarr-1',
      name: 'Lidarr One',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 1,
        externalId: 11,
      }),
      testConnection: vi.fn(),
    }
    const secondLidarrTarget = {
      id: 'lidarr-2',
      name: 'Lidarr Two',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'lidarr',
        targetId: 2,
        externalId: 22,
      }),
      testConnection: vi.fn(),
    }
    const mockSlskdTarget = {
      id: 'slskd-7',
      name: 'slskd',
      type: 'slskd',
      capabilities: ['addArtist'],
      linkedLidarrTargetId: 'lidarr-2',
      addArtist: vi.fn().mockResolvedValue({
        success: true,
        targetType: 'slskd',
        targetId: 7,
      }),
      testConnection: vi.fn(),
    }

    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi
          .fn()
          .mockResolvedValue([firstLidarrTarget, secondLidarrTarget, mockSlskdTarget] as never),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({
        status: 'approved',
        approvalMode: 'combined_lidarr_slskd',
        targetId: 'slskd-7',
        lidarrTargetId: 'lidarr-2',
      }),
    })

    expect(res.status).toBe(200)
    expect(firstLidarrTarget.addArtist).not.toHaveBeenCalled()
    expect(secondLidarrTarget.addArtist).toHaveBeenCalledBefore(mockSlskdTarget.addArtist as never)
    expect(mockSlskdTarget.addArtist).toHaveBeenCalledWith(
      { mbid: 'mbid-abc-123', name: 'Test Artist' },
      expect.objectContaining({
        lidarrArtistId: 22,
      }),
    )
  })

  it('rejects combined approval when more than one Lidarr target is enabled', async () => {
    const firstLidarrTarget = {
      id: 'lidarr-1',
      name: 'Lidarr One',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn(),
      testConnection: vi.fn(),
    }
    const secondLidarrTarget = {
      id: 'lidarr-2',
      name: 'Lidarr Two',
      type: 'lidarr',
      capabilities: ['addArtist'],
      addArtist: vi.fn(),
      testConnection: vi.fn(),
    }
    const mockSlskdTarget = {
      id: 'slskd-7',
      name: 'slskd',
      type: 'slskd',
      capabilities: ['addArtist'],
      addArtist: vi.fn(),
      testConnection: vi.fn(),
    }

    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi
          .fn()
          .mockResolvedValue([firstLidarrTarget, secondLidarrTarget, mockSlskdTarget] as never),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({
        status: 'approved',
        approvalMode: 'combined_lidarr_slskd',
        targetId: 'slskd-7',
      }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      type: '/problems/http-400',
      title: 'Bad Request',
      status: 400,
      detail: 'Combined approval requires exactly one enabled Lidarr target',
      error: 'Combined approval requires exactly one enabled Lidarr target',
    })
    expect(firstLidarrTarget.addArtist).not.toHaveBeenCalled()
    expect(secondLidarrTarget.addArtist).not.toHaveBeenCalled()
    expect(mockSlskdTarget.addArtist).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/recommendations/bulk', () => {
  describe('Idempotency-Key', () => {
    const post = (app: ReturnType<typeof createApp>, body: unknown, key?: string) =>
      authedRequest(app, '/api/v1/recommendations/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key !== undefined ? { 'Idempotency-Key': key } : {}),
        },
        body: JSON.stringify(body),
      })
    const body = { ids: [1, 2], action: 'reject' }

    it('replays the stored response for the same key and body', async () => {
      const deps = makeDeps({ filterOwnedIds: vi.fn(async () => [1]) })
      const app = createApp(deps)
      const first = await post(app, body, 'k-1')
      const second = await post(app, body, 'k-1')

      expect(first.headers.get('Idempotent-Replayed')).toBeNull()
      expect(second.status).toBe(200)
      expect(second.headers.get('Idempotent-Replayed')).toBe('true')
      expect(await second.json()).toEqual(await first.json())
      expect(deps.bulkUpdateStatus).toHaveBeenCalledTimes(1)
    })

    it('returns 422 when the key is reused with a different body', async () => {
      const app = createApp(makeDeps())
      await post(app, body, 'k-2')
      const res = await post(app, { ...body, ids: [3] }, 'k-2')

      expect(res.status).toBe(422)
      expect(res.headers.get('content-type')).toContain('application/problem+json')
    })

    it('returns 409 while a request with the same key is in flight', async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const deps = makeDeps({
        filterOwnedIds: vi.fn(async () => {
          await gate
          return [1]
        }),
      })
      const app = createApp(deps)
      const first = post(app, body, 'k-3')
      await vi.waitFor(() => expect(deps.filterOwnedIds).toHaveBeenCalled())
      const res = await post(app, body, 'k-3')
      release()

      expect(res.status).toBe(409)
      expect((await first).status).toBe(200)
    })

    it('does not store 5xx responses', async () => {
      const filterOwnedIds = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([1])
      const app = createApp(makeDeps({ filterOwnedIds }))
      expect((await post(app, body, 'k-4')).status).toBe(500)
      const retry = await post(app, body, 'k-4')

      expect(retry.status).toBe(200)
      expect(retry.headers.get('Idempotent-Replayed')).toBeNull()
    })

    it('rejects an invalid key', async () => {
      const app = createApp(makeDeps())
      expect((await post(app, body, 'has space')).status).toBe(400)
      expect((await post(app, body, 'x'.repeat(256))).status).toBe(400)
    })

    it('runs every request when no key is sent', async () => {
      const deps = makeDeps({ filterOwnedIds: vi.fn(async () => [1]) })
      const app = createApp(deps)
      await post(app, body)
      const second = await post(app, body)

      expect(second.headers.get('Idempotent-Replayed')).toBeNull()
      expect(deps.bulkUpdateStatus).toHaveBeenCalledTimes(2)
    })
  })

  it('rejects permanent not_right_now before ownership queries or writes', async () => {
    const deps = makeDeps()
    const app = createApp(deps)
    const res = await authedRequest(app, '/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: [1, 2],
        action: 'reject',
        reason: 'not_right_now',
        permanent: true,
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      code: 'validation_failed',
      details: [{ path: ['permanent'], code: 'custom' }],
    })
    expect(deps.filterOwnedIds).not.toHaveBeenCalled()
    expect(deps.getRecommendation).not.toHaveBeenCalled()
    expect(deps.rejectRecommendation).not.toHaveBeenCalled()
    expect(deps.bulkUpdateStatus).not.toHaveBeenCalled()
    expect(deps.updateRecommendationStatus).not.toHaveBeenCalled()
  })

  it.each([
    { reason: 'not_right_now', permanent: false },
    { reason: 'not_right_now' },
    { reason: 'other', permanent: true },
    { reason: null, permanent: true },
    { permanent: true },
    { reason: null },
    {},
  ])('preserves owned bulk rejection semantics for %j', async (fields) => {
    const deps = makeDeps({ filterOwnedIds: vi.fn(async () => [1]) })
    const app = createApp(deps)
    const res = await authedRequest(app, '/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: [1, 2],
        action: 'reject',
        ...fields,
        reasonText: 'not supported in bulk',
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1 })
    expect(deps.filterOwnedIds).toHaveBeenCalledWith([1, 2], 1)
    if (fields.reason || fields.permanent) {
      expect(deps.rejectRecommendation).toHaveBeenCalledExactlyOnceWith({
        recommendationId: 1,
        userId: 1,
        reason: fields.reason ?? null,
        reasonText: null,
        permanent: fields.permanent ?? false,
      })
      expect(deps.bulkUpdateStatus).not.toHaveBeenCalled()
    } else {
      expect(deps.bulkUpdateStatus).toHaveBeenCalledExactlyOnceWith([1], 'rejected')
      expect(deps.rejectRecommendation).not.toHaveBeenCalled()
    }
  })

  it('ignores rejection compatibility fields when bulk approving', async () => {
    const deps = makeDeps()
    const app = createApp(deps)
    const res = await authedRequest(app, '/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: [1],
        action: 'approve',
        reason: 'not_right_now',
        permanent: true,
      }),
    })

    expect(res.status).toBe(200)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(1, 'approved', expect.any(Object))
    expect(deps.rejectRecommendation).not.toHaveBeenCalled()
    expect(deps.bulkUpdateStatus).not.toHaveBeenCalled()
  })

  it('bulk rejects without calling Lidarr', async () => {
    const bulkUpdateStatus = vi.fn(async () => {})
    const filterOwnedIds = vi.fn(async (ids: number[]) => ids)
    const app = createApp(makeDeps({ bulkUpdateStatus, filterOwnedIds }))
    const res = await authedRequest(app, '/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2, 3], action: 'reject' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(3)
    expect(filterOwnedIds).toHaveBeenCalledWith([1, 2, 3], 1)
    expect(bulkUpdateStatus).toHaveBeenCalledWith([1, 2, 3], 'rejected')
  })

  it('bulk rejects with a shared reason via rejectRecommendation per id', async () => {
    const bulkUpdateStatus = vi.fn(async () => {})
    const rejectRecommendation = vi.fn(async () => ({ artistId: 1, blockCreated: false }))
    const filterOwnedIds = vi.fn(async (ids: number[]) => ids)
    const app = createApp(makeDeps({ bulkUpdateStatus, rejectRecommendation, filterOwnedIds }))
    const res = await authedRequest(app, '/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: [1, 2],
        action: 'reject',
        reason: 'wrong_style',
        permanent: true,
      }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).updated).toBe(2)
    // Shared-reason path routes each id through rejectRecommendation, not the
    // reason-less bulk fast path.
    expect(bulkUpdateStatus).not.toHaveBeenCalled()
    expect(rejectRecommendation).toHaveBeenCalledTimes(2)
    expect(rejectRecommendation).toHaveBeenCalledWith({
      recommendationId: 1,
      userId: 1,
      reason: 'wrong_style',
      reasonText: null,
      permanent: true,
    })
  })

  it('returns 400 for invalid action', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [1], action: 'delete' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing ids', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [], action: 'reject' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when bulk approve targetId does not match an enabled target', async () => {
    const app = createApp(
      makeDeps({
        getEnabledTargetsForUser: vi.fn().mockResolvedValue([
          {
            id: 'lidarr-1',
            name: 'Lidarr',
            type: 'lidarr',
            capabilities: ['addArtist'],
            addArtist: vi.fn(),
          },
        ]),
      }),
    )

    const res = await authedRequest(app, '/api/v1/recommendations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ ids: [1], action: 'approve', targetId: 'missing-target' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      type: '/problems/http-400',
      title: 'Bad Request',
      status: 400,
      detail: 'Unknown targetId: missing-target',
      error: 'Unknown targetId: missing-target',
    })
  })
})

describe('GET /api/v1/recommendations/feedback-summary', () => {
  it('returns genre feedback summary sorted by approval rate', async () => {
    const history = new Map([
      ['jazz', { approved: 2, rejected: 1, total: 5 }],
      ['rock', { approved: 8, rejected: 1, total: 10 }],
      ['pop', { approved: 1, rejected: 0, total: 1 }],
      ['legacy', { approved: 0, total: 3 }],
    ])
    const app = createApp(
      makeDeps({
        getFeedbackHistory: vi.fn().mockResolvedValue(history),
      }),
    )
    const res = await authedRequest(app, '/api/v1/recommendations/feedback-summary')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toEqual([
      { genre: 'rock', approved: 8, rejected: 1, other: 1, total: 10, rate: 0.8 },
      { genre: 'jazz', approved: 2, rejected: 1, other: 2, total: 5, rate: 0.4 },
      { genre: 'legacy', approved: 0, rejected: 0, other: 3, total: 3, rate: 0 },
    ])
  })

  it('limits the summary to the twenty highest approval rates', async () => {
    const history = new Map(
      Array.from(
        { length: 25 },
        (_, approved) => [`genre-${approved}`, { approved, rejected: 1, total: 30 }] as const,
      ),
    )
    const app = createApp(makeDeps({ getFeedbackHistory: vi.fn().mockResolvedValue(history) }))
    const res = await authedRequest(app, '/api/v1/recommendations/feedback-summary')
    const body = await res.json()
    expect(body.summary).toEqual(
      Array.from({ length: 20 }, (_, i) => {
        const approved = 24 - i
        return {
          genre: `genre-${approved}`,
          approved,
          rejected: 1,
          other: 29 - approved,
          total: 30,
          rate: approved / 30,
        }
      }),
    )
  })

  it('returns empty summary when no feedback data', async () => {
    const app = createApp(makeDeps())
    const res = await authedRequest(app, '/api/v1/recommendations/feedback-summary')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary).toHaveLength(0)
  })

  it('scopes feedback history to the current user', async () => {
    const getFeedbackHistory = vi.fn().mockResolvedValue(new Map())
    const app = createApp(makeDeps({ getFeedbackHistory }))
    await authedRequest(app, '/api/v1/recommendations/feedback-summary')
    expect(getFeedbackHistory).toHaveBeenCalledWith(1)
  })
})

describe('GET /api/v1/recommendations/playability', () => {
  it('returns the persisted playability summary for the current user', async () => {
    const summary = {
      pendingArtists: 3,
      withTrack: 1,
      withoutTrack: 1,
      reasons: { missingSource: 0, noMatch: 1, upstreamFailure: 0 },
      unknown: 1,
      checkedAt: '2026-10-02T00:00:00.000Z',
    }
    vi.mocked(getPendingPlayability).mockResolvedValueOnce(summary)
    const deps = makeDeps()
    const res = await authedRequest(createApp(deps), '/api/v1/recommendations/playability')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(summary)
    expect(getPendingPlayability).toHaveBeenCalledWith(deps.db, 1)
  })
})

describe('deferred Lidarr approvals', () => {
  it.each([
    ['artist', false, 'HTTP 503: unavailable', 'waiting'],
    ['album', false, 'HTTP 503: metadata server unavailable', 'waiting'],
    ['artist', true, 'connect ECONNREFUSED', 'waiting'],
    ['album', true, 'read ECONNRESET', 'waiting'],
    ['artist', false, 'HTTP 400: invalid profile', 'add_failed'],
    ['album', false, 'HTTP 401: unauthorized', 'add_failed'],
  ])('persists %s bulk=%s failure %s as %s', async (kind, bulk, error, status) => {
    const rec = {
      ...mockRecommendation,
      kind,
      recommendedReleaseGroupId: kind === 'album' ? 'rg-1' : null,
    }
    const target = {
      id: 'lidarr-1',
      name: 'Lidarr',
      type: 'lidarr',
      capabilities: ['addArtist', 'addAlbum'],
      addArtist: vi
        .fn()
        .mockResolvedValue({ success: false, targetType: 'lidarr', targetId: 1, error }),
      addAlbum: vi
        .fn()
        .mockResolvedValue({ success: false, targetType: 'lidarr', targetId: 1, error }),
    }
    const deps = makeDeps({
      getRecommendation: vi.fn(async () => rec),
      getUserCount: vi.fn(async () => 1),
      getEnabledTargetsForUser: vi.fn().mockResolvedValue([target]),
    })
    const res = await authedRequest(
      createApp(deps),
      bulk ? '/api/v1/recommendations/bulk' : '/api/v1/recommendations/1',
      {
        method: bulk ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify(bulk ? { ids: [1], action: 'approve' } : { status: 'approved' }),
      },
    )
    expect(res.status).toBe(200)
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      status,
      expect.objectContaining({
        targetActions: {
          'lidarr-1': expect.objectContaining({
            status: status === 'waiting' ? 'waiting' : 'failed',
          }),
        },
      }),
    )
  })

  it('manual Retry runs waiting work immediately, preserving options and successful targets', async () => {
    const addArtist = vi
      .fn()
      .mockResolvedValue({ success: true, targetType: 'lidarr', targetId: 1, externalId: 42 })
    const successful = vi.fn()
    const rec = {
      ...mockRecommendation,
      status: 'waiting',
      targetActions: {
        'lidarr-1': {
          status: 'waiting',
          error: 'HTTP 503',
          retry: {
            startedAt: new Date().toISOString(),
            nextAttemptAt: new Date(Date.now() + 3600000).toISOString(),
            attempts: 2,
            options: { monitorOption: 'selected', selectedAlbumIds: ['rg-1'], rootFolderId: 3 },
          },
        },
        'slskd-2': { status: 'queued' },
      },
    }
    const recorder = {
      start: vi.fn(async () => 99),
      complete: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
      markStuck: vi.fn(),
    }
    const deps = makeDeps({
      jobRecorder: recorder,
      getRecommendation: vi.fn(async () => rec),
      getUserCount: vi.fn(async () => 1),
      getEnabledTargetsForUser: vi.fn().mockResolvedValue([
        { id: 'lidarr-1', type: 'lidarr', capabilities: ['addArtist'], addArtist },
        { id: 'slskd-2', type: 'slskd', capabilities: ['addArtist'], addArtist: successful },
      ]),
    })
    const res = await authedRequest(createApp(deps), '/api/v1/recommendations/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ status: 'approved' }),
    })
    expect(res.status).toBe(200)
    expect(addArtist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        retryExisting: true,
        monitorOption: 'selected',
        selectedAlbumIds: ['rg-1'],
        rootFolderId: 3,
      }),
    )
    expect(successful).not.toHaveBeenCalled()
    expect(recorder.start).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          monitorOption: 'selected',
          selectedAlbumIds: ['rg-1'],
        }),
      }),
    )
    expect(deps.updateRecommendationStatus).toHaveBeenCalledWith(
      1,
      'added_to_lidarr',
      expect.objectContaining({
        targetActions: expect.objectContaining({ 'slskd-2': { status: 'queued' } }),
      }),
    )
  })
})
