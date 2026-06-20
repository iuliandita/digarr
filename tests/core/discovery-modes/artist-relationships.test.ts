// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSearchArtist = vi.fn()
const mockLookupArtistRelations = vi.fn()
vi.mock('@/core/clients/musicbrainz', () => ({
  createMusicBrainzClient: vi.fn(() => ({
    searchArtist: mockSearchArtist,
    lookupArtistRelations: mockLookupArtistRelations,
  })),
}))

import { createArtistRelationshipsMode } from '@/core/discovery-modes/modes/artist-relationships'
import type { DiscoveryModeRequest } from '@/core/discovery-modes/request'

function makeRequest(settings: Record<string, unknown>): DiscoveryModeRequest {
  return {
    modeId: 'artist-relationships',
    triggerType: 'manual',
    settingsMode: 'advanced',
    userId: 1,
    rawUserSettings: settings,
    normalizedSettings: settings,
    providerContext: { providerPath: ['musicbrainz'] },
    fallbackPolicy: 'strict',
  }
}

describe('artist-relationships mode', () => {
  beforeEach(() => {
    mockSearchArtist.mockReset()
    mockLookupArtistRelations.mockReset()
  })

  it('returns related artists from MB artist-artist relations, excluding seeds', async () => {
    mockLookupArtistRelations.mockResolvedValue({
      id: 'seed-mbid',
      name: 'Seed Band',
      relations: [
        { type: 'member of band', artist: { id: 'm1', name: 'Member One' } },
        { type: 'collaboration', artist: { id: 'c1', name: 'Collaborator' } },
        { type: 'member of band', artist: { id: 'seed-mbid', name: 'Seed Band' } }, // self
        { type: 'url', url: { resource: 'https://example.com' } }, // non-artist
      ],
    })

    const mode = createArtistRelationshipsMode()
    const result = await mode.executor(
      makeRequest({ seedArtists: [{ name: 'Seed Band', mbid: 'seed-mbid' }] }),
    )

    expect(mockSearchArtist).not.toHaveBeenCalled() // mbid supplied, no resolve needed
    expect(result.candidates.map((c) => c.name)).toEqual(['Member One', 'Collaborator'])
    expect(result.candidates[0]).toMatchObject({
      candidateType: 'artist',
      mbid: 'm1',
      provenanceProvider: 'musicbrainz',
      explanationHint: 'member of band',
    })
  })

  it('filters by selected relationship types', async () => {
    mockLookupArtistRelations.mockResolvedValue({
      id: 'seed-mbid',
      name: 'Seed',
      relations: [
        { type: 'member of band', artist: { id: 'm1', name: 'Member One' } },
        { type: 'collaboration', artist: { id: 'c1', name: 'Collaborator' } },
      ],
    })

    const mode = createArtistRelationshipsMode()
    const result = await mode.executor(
      makeRequest({
        seedArtists: [{ name: 'Seed', mbid: 'seed-mbid' }],
        relationshipTypes: ['collaboration'],
      }),
    )

    expect(result.candidates.map((c) => c.name)).toEqual(['Collaborator'])
  })

  it('resolves a seed name to an MBID via search when none is supplied', async () => {
    mockSearchArtist.mockResolvedValue({ artists: [{ id: 'resolved', name: 'Seed', score: 100 }] })
    mockLookupArtistRelations.mockResolvedValue({
      id: 'resolved',
      name: 'Seed',
      relations: [{ type: 'collaboration', artist: { id: 'c1', name: 'Collaborator' } }],
    })

    const mode = createArtistRelationshipsMode()
    const result = await mode.executor(makeRequest({ seedArtists: ['Seed'] }))

    expect(mockSearchArtist).toHaveBeenCalledWith('Seed')
    expect(mockLookupArtistRelations).toHaveBeenCalledWith('resolved')
    expect(result.candidates.map((c) => c.name)).toEqual(['Collaborator'])
  })

  it('throws when no seed artists are provided', async () => {
    const mode = createArtistRelationshipsMode()
    await expect(mode.executor(makeRequest({ seedArtists: [] }))).rejects.toThrow(/seed artist/i)
  })
})
