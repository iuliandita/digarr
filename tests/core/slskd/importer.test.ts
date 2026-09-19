// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { LidarrManualImportCandidate } from '@/core/clients/lidarr'
import {
  buildLidarrManualImport,
  mapSlskdReleasePaths,
  type SlskdImportClient,
} from '@/core/slskd/importer'

const release = {
  files: [
    { filename: 'Artist\\Album\\01.flac', size: 100 },
    { filename: 'Artist\\Album\\02.flac', size: 200 },
  ],
}

const job = {
  releaseTitle: 'Album',
  lidarrArtistId: 7,
  lidarrAlbumId: 8,
}

function candidates(): [LidarrManualImportCandidate, LidarrManualImportCandidate] {
  return [
    {
      path: '/downloads/Album/01.flac',
      artist: { id: 7 },
      album: { id: 8 },
      tracks: [{ id: 81 }],
      quality: { quality: { id: 7, name: 'FLAC' } },
      rejections: [],
    },
    {
      path: '/downloads/Album/02.flac',
      artist: { id: 7 },
      album: { id: 8 },
      tracks: [{ id: 82 }],
      quality: { quality: { id: 7, name: 'FLAC' } },
      rejections: [],
    },
  ]
}

function makeLidarrClient(overrides: Partial<SlskdImportClient>): SlskdImportClient {
  return {
    getAlbums: vi.fn(async () => []),
    getManualImport: vi.fn(async () => []),
    updateManualImport: vi.fn(async () => []),
    getTracks: vi.fn(async () => []),
    ...overrides,
  }
}

describe('mapSlskdReleasePaths', () => {
  it('maps each remote directory to its leaf folder under the Lidarr-visible base', () => {
    expect(
      mapSlskdReleasePaths(
        {
          files: [
            { filename: 'Artist\\Album\\CD 1\\01.flac', size: 100 },
            { filename: 'Artist\\Album\\CD 2\\02.flac', size: 200 },
          ],
        },
        '/downloads',
      ),
    ).toEqual({
      folders: ['/downloads/CD 1', '/downloads/CD 2'],
      audioFiles: ['/downloads/CD 1/01.flac', '/downloads/CD 2/02.flac'],
    })
  })

  it('rejects distinct remote directories that collide on one leaf folder', () => {
    expect(() =>
      mapSlskdReleasePaths(
        {
          files: [
            { filename: 'Artist\\Album A\\Disc 1\\01.flac', size: 100 },
            { filename: 'Artist\\Album B\\Disc 1\\02.flac', size: 200 },
          ],
        },
        '/downloads',
      ),
    ).toThrow(/ambiguous slskd directory mapping/)
  })
})

describe('buildLidarrManualImport', () => {
  it('rejects Lidarr partial-release rejections', async () => {
    const rows = candidates()
    rows[0].rejections = [{ reason: 'Has missing tracks' }]

    await expect(
      buildLidarrManualImport(
        job,
        release,
        '/downloads',
        makeLidarrClient({
          getManualImport: vi.fn(async () => rows),
          getTracks: vi.fn(),
        }),
      ),
    ).rejects.toThrow(/Has missing tracks/)
  })

  it('rejects candidates resolving to multiple albums', async () => {
    const rows = candidates()
    rows[1].album = { id: 9 }

    await expect(
      buildLidarrManualImport(
        job,
        release,
        '/downloads',
        makeLidarrClient({
          getManualImport: vi.fn(async () => rows),
          getTracks: vi.fn(),
        }),
      ),
    ).rejects.toThrow(/one album/)
  })

  it('rejects candidates without track IDs', async () => {
    const rows = candidates()
    rows[1].tracks = []

    await expect(
      buildLidarrManualImport(
        job,
        release,
        '/downloads',
        makeLidarrClient({
          getManualImport: vi.fn(async () => rows),
          getTracks: vi.fn(),
        }),
      ),
    ).rejects.toThrow(/has no tracks/)
  })

  it('uses an exact single-title fallback only after Lidarr tag-confirms the artist', async () => {
    const initial = candidates().map((candidate) => ({
      ...candidate,
      album: undefined,
      tracks: [],
      rejections: [{ reason: 'Unable to identify release' }],
    }))
    const resolved = candidates()
    const updateManualImport = vi.fn(async () => resolved)

    const result = await buildLidarrManualImport(
      job,
      release,
      '/downloads',
      makeLidarrClient({
        getManualImport: vi.fn(async () => initial),
        getAlbums: vi.fn(async () => [
          {
            id: 8,
            title: 'Album',
            artistId: 7,
            foreignAlbumId: 'rg-1',
            monitored: true,
            albumType: 'Album',
            statistics: { trackCount: 2, trackFileCount: 0, percentOfTracks: 0 },
          },
        ]),
        updateManualImport,
        getTracks: vi.fn(async () => [
          { id: 81, hasFile: false },
          { id: 82, hasFile: false },
        ]),
      }),
    )

    expect(updateManualImport).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ albumId: 8, expectedTrackIds: [81, 82] })
  })

  it('refuses ambiguous exact-title fallback matches', async () => {
    const initial = candidates().map((candidate) => ({
      ...candidate,
      album: undefined,
      tracks: [],
    }))
    const album = {
      id: 8,
      title: 'Album',
      artistId: 7,
      foreignAlbumId: 'rg-1',
      monitored: true,
      albumType: 'Album',
      statistics: { trackCount: 2, trackFileCount: 0, percentOfTracks: 0 },
    }

    await expect(
      buildLidarrManualImport(
        job,
        release,
        '/downloads',
        makeLidarrClient({
          getManualImport: vi.fn(async () => initial),
          getAlbums: vi.fn(async () => [album, { ...album, id: 9 }]),
          updateManualImport: vi.fn(),
          getTracks: vi.fn(),
        }),
      ),
    ).rejects.toThrow(/2 exact title matches/)
  })

  it.each([
    {
      name: 'drops files',
      resolved: () => candidates().slice(0, 1),
      error: /do not exactly match/,
    },
    {
      name: 'changes paths',
      resolved: () => [
        candidates()[0],
        { ...candidates()[1], path: '/downloads/Album/other.flac' },
      ],
      error: /do not exactly match/,
    },
    {
      name: 'retains a partial-release rejection',
      resolved: () => {
        const rows = candidates()
        rows[0].rejections = [{ reason: 'Has fewer tracks than existing release' }]
        return rows
      },
      error: /Has fewer tracks than existing release/,
    },
  ])('revalidates fallback output when it $name', async ({ resolved, error }) => {
    const initial = candidates().map((candidate) => ({
      ...candidate,
      album: undefined,
      tracks: [],
      rejections: [{ reason: 'Unable to identify release' }],
    }))

    await expect(
      buildLidarrManualImport(
        job,
        release,
        '/downloads',
        makeLidarrClient({
          getManualImport: vi.fn(async () => initial),
          getAlbums: vi.fn(async () => [
            {
              id: 8,
              title: 'Album',
              artistId: 7,
              foreignAlbumId: 'rg-1',
              monitored: true,
              albumType: 'Album',
              statistics: { trackCount: 2, trackFileCount: 0, percentOfTracks: 0 },
            },
          ]),
          updateManualImport: vi.fn(async () => resolved()),
          getTracks: vi.fn(),
        }),
      ),
    ).rejects.toThrow(error)
  })
})
