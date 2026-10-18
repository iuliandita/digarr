import { describe, expect, it } from 'vitest'
import { ARTIST_EXTERNAL_LINK_KEYS } from '@/core/artists/external-links'
import { en } from '@/core/i18n/messages/en'
import { REJECTION_REASONS } from '@/core/recommendations/rejection-reasons'

function keysUnder(prefix: string): string[] {
  return Object.keys(en)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .sort()
}

describe('message catalogs', () => {
  it('rejection-reason messages match the live reason registry', () => {
    expect(keysUnder('rejectionReason.')).toEqual([...REJECTION_REASONS].sort())
  })

  it('artist external-link messages match the live link registry', () => {
    expect(keysUnder('artist.externalLinks.')).toEqual([...ARTIST_EXTERNAL_LINK_KEYS].sort())
  })
})
