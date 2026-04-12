// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('p-queue', () => {
  const mockAdd = vi.fn((fn: () => unknown) => fn())
  const MockPQueue = vi.fn().mockImplementation(function (this: { add: typeof mockAdd }) {
    this.add = mockAdd
  })
  return { default: MockPQueue }
})

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lookupRecording(mbid)', () => {
  it('fetches /recording/{mbid} with artist-credits inc', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'rec-mbid',
        title: 'Wandering Star',
        'artist-credit': [
          {
            artist: {
              id: 'artist-mbid-1',
              name: 'Portishead',
            },
          },
        ],
      }),
    )

    const client = createMusicBrainzClient()
    const result = await client.lookupRecording('rec-mbid')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/recording/rec-mbid'),
      expect.anything(),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('inc=artist-credits'),
      expect.anything(),
    )
    expect(result).toEqual({
      recordingMbid: 'rec-mbid',
      artistMbid: 'artist-mbid-1',
      artistName: 'Portishead',
    })
  })

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))

    const client = createMusicBrainzClient()
    const result = await client.lookupRecording('missing-mbid')
    expect(result).toBeNull()
  })

  it('returns null when artist-credit array is empty', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'rec-mbid',
        title: 'Untitled',
        'artist-credit': [],
      }),
    )

    const client = createMusicBrainzClient()
    const result = await client.lookupRecording('rec-mbid')
    expect(result).toBeNull()
  })

  it('uses the first artist credit when multiple exist', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'rec-mbid',
        title: 'Collab Track',
        'artist-credit': [
          { artist: { id: 'primary-mbid', name: 'Primary Artist' } },
          { artist: { id: 'feat-mbid', name: 'Featured Artist' } },
        ],
      }),
    )

    const client = createMusicBrainzClient()
    const result = await client.lookupRecording('rec-mbid')
    expect(result).toEqual({
      recordingMbid: 'rec-mbid',
      artistMbid: 'primary-mbid',
      artistName: 'Primary Artist',
    })
  })

  it('throws on non-404 errors', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Server Error', { status: 500 }))

    const client = createMusicBrainzClient()
    await expect(client.lookupRecording('bad-mbid')).rejects.toThrow(/500/)
  })
})
