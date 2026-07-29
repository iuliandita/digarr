// @vitest-environment node

import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { libraryAlbums, libraryArtists, users } from '@/db/schema'

describe('users schema indexes', () => {
  it('defines partial unique indexes for nullable identity fields', () => {
    const config = getTableConfig(users)
    const indexNames = config.indexes.map((index) => index.config.name)

    expect(indexNames).toContain('users_email_unique_idx')
    expect(indexNames).toContain('users_oidc_subject_unique_idx')
  })
})

describe('library reconciliation schema', () => {
  it('defines nullable unreconciled reason columns', () => {
    const artistColumns = getTableConfig(libraryArtists).columns
    const albumColumns = getTableConfig(libraryAlbums).columns

    expect(artistColumns).toContainEqual(
      expect.objectContaining({ name: 'unreconciled_reason', notNull: false }),
    )
    expect(albumColumns).toContainEqual(
      expect.objectContaining({ name: 'unreconciled_reason', notNull: false }),
    )
  })
})
