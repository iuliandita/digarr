import { describe, expect, it } from 'vitest'
import { metadataProfileRejection } from '@/core/targets/lidarr-metadata-profile'

const items = (all: string[], allowed: string[]) =>
  all.map((type) => ({ albumType: { name: type }, allowed: allowed.includes(type) }))

const studioAlbumOnly = {
  id: 5,
  name: 'StudioAlbumOnly',
  primaryAlbumTypes: items(['Album', 'EP', 'Single', 'Broadcast', 'Other'], ['Album']),
  secondaryAlbumTypes: items(['Studio', 'Compilation', 'Live', 'DJ-mix'], ['Studio', 'DJ-mix']),
  releaseStatuses: ['Official', 'Bootleg'].map((name) => ({
    releaseStatus: { name },
    allowed: name === 'Official',
  })),
}

describe('metadataProfileRejection', () => {
  it.each([
    ['studio album', { primaryType: 'Album', secondaryTypes: [] }, null],
    ['compilation', { primaryType: 'Album', secondaryTypes: ['Compilation'] }, 'secondary'],
    ['EP', { primaryType: 'EP', secondaryTypes: [] }, 'primary'],
    ['case-insensitive dj-mix', { primaryType: 'album', secondaryTypes: ['dj-mix'] }, null],
    ['any allowed secondary', { primaryType: 'Album', secondaryTypes: ['Live', 'DJ-mix'] }, null],
    [
      'bootleg only',
      { primaryType: 'Album', secondaryTypes: [], releaseStatuses: ['Bootleg'] },
      'status',
    ],
    [
      'one official release',
      { primaryType: 'Album', releaseStatuses: ['Bootleg', 'Official'] },
      null,
    ],
    ['unknown secondary types', { primaryType: 'Album' }, null],
    ['unknown primary type', { secondaryTypes: [] }, null],
  ])('%s', (_label, types, reason) => {
    expect(metadataProfileRejection(studioAlbumOnly, types)?.reason ?? null).toBe(reason)
  })

  it('never rejects against a profile without type lists', () => {
    expect(
      metadataProfileRejection(
        { id: 1, name: 'Old' },
        { primaryType: 'EP', secondaryTypes: ['Live'] },
      ),
    ).toBeNull()
  })
})
