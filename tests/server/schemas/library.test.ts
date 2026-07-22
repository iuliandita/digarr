// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { libraryAlbumBulkIgnoreSchema, libraryBulkIgnoreSchema } from '@/server/schemas/library'

describe('libraryBulkIgnoreSchema', () => {
  const item = { source: 'plex', sourceArtistId: 'artist-1' }

  it('accepts one artist identity', () => {
    expect(libraryBulkIgnoreSchema.safeParse({ items: [item] }).success).toBe(true)
  })

  it('rejects an empty item list', () => {
    expect(libraryBulkIgnoreSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('rejects more than 200 items', () => {
    expect(
      libraryBulkIgnoreSchema.safeParse({
        items: Array.from({ length: 201 }, (_, index) => ({
          source: 'plex',
          sourceArtistId: `artist-${index}`,
        })),
      }).success,
    ).toBe(false)
  })

  it('rejects unknown outer fields', () => {
    expect(libraryBulkIgnoreSchema.safeParse({ items: [item], extra: true }).success).toBe(false)
  })

  it('rejects unknown item fields', () => {
    expect(libraryBulkIgnoreSchema.safeParse({ items: [{ ...item, extra: true }] }).success).toBe(
      false,
    )
  })

  it('rejects duplicate artist identities', () => {
    const result = libraryBulkIgnoreSchema.safeParse({ items: [item, item] })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ message: 'Duplicate artist', path: ['items', 1] }),
      )
    }
  })

  it('accepts the same artist ID from different sources', () => {
    expect(
      libraryBulkIgnoreSchema.safeParse({
        items: [item, { source: 'jellyfin', sourceArtistId: item.sourceArtistId }],
      }).success,
    ).toBe(true)
  })
})

describe('libraryAlbumBulkIgnoreSchema', () => {
  const item = { source: 'plex', sourceAlbumId: 'album-1' }

  it('accepts one album identity', () => {
    expect(libraryAlbumBulkIgnoreSchema.safeParse({ items: [item] }).success).toBe(true)
  })

  it('rejects an empty item list', () => {
    expect(libraryAlbumBulkIgnoreSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('rejects more than 200 items', () => {
    expect(
      libraryAlbumBulkIgnoreSchema.safeParse({
        items: Array.from({ length: 201 }, (_, index) => ({
          source: 'plex',
          sourceAlbumId: `album-${index}`,
        })),
      }).success,
    ).toBe(false)
  })

  it('rejects unknown outer fields', () => {
    expect(libraryAlbumBulkIgnoreSchema.safeParse({ items: [item], extra: true }).success).toBe(
      false,
    )
  })

  it('rejects unknown item fields', () => {
    expect(
      libraryAlbumBulkIgnoreSchema.safeParse({ items: [{ ...item, extra: true }] }).success,
    ).toBe(false)
  })

  it('rejects duplicate album identities', () => {
    const result = libraryAlbumBulkIgnoreSchema.safeParse({ items: [item, item] })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ message: 'Duplicate album', path: ['items', 1] }),
      )
    }
  })

  it('accepts the same album ID from different sources', () => {
    expect(
      libraryAlbumBulkIgnoreSchema.safeParse({
        items: [item, { source: 'jellyfin', sourceAlbumId: item.sourceAlbumId }],
      }).success,
    ).toBe(true)
  })
})
