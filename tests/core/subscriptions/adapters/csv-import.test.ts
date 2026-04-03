// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createCsvImportAdapter, parseCsvArtists } from '@/core/subscriptions/adapters/csv-import'

describe('parseCsvArtists', () => {
  it('parses header row with "artist" column', () => {
    const csv = 'artist,genre\nRadiohead,alt-rock\nPortishead,trip-hop'
    expect(parseCsvArtists(csv)).toEqual(['Radiohead', 'Portishead'])
  })

  it('detects "Artist Name" header (case-insensitive)', () => {
    const csv = 'Artist Name,Year\nBjork,1993\nMassive Attack,1991'
    expect(parseCsvArtists(csv)).toEqual(['Bjork', 'Massive Attack'])
  })

  it('detects "name" header', () => {
    const csv = 'name\nRadiohead\nPortishead'
    expect(parseCsvArtists(csv)).toEqual(['Radiohead', 'Portishead'])
  })

  it('falls back to first column when no known header matches', () => {
    const csv = 'band,album\nRadiohead,OK Computer\nPortishead,Dummy'
    expect(parseCsvArtists(csv)).toEqual(['Radiohead', 'Portishead'])
  })

  it('treats single-column headerless file as artist names', () => {
    const csv = 'Radiohead\nPortishead\nMassive Attack'
    expect(parseCsvArtists(csv)).toEqual(['Radiohead', 'Portishead', 'Massive Attack'])
  })

  it('deduplicates by lowercase name', () => {
    const csv = 'artist\nRadiohead\nradiohead\nRADIOHEAD'
    expect(parseCsvArtists(csv)).toEqual(['Radiohead'])
  })

  it('trims whitespace and skips empty rows', () => {
    const csv = 'artist\n  Radiohead  \n\n  \nPortishead'
    expect(parseCsvArtists(csv)).toEqual(['Radiohead', 'Portishead'])
  })

  it('returns empty array for empty input', () => {
    expect(parseCsvArtists('')).toEqual([])
  })

  it('handles Windows line endings (CRLF)', () => {
    const csv = 'artist\r\nRadiohead\r\nPortishead\r\n'
    expect(parseCsvArtists(csv)).toEqual(['Radiohead', 'Portishead'])
  })

  it('truncates to maxArtists', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Artist ${i}`)
    const csv = `artist\n${lines.join('\n')}`
    expect(parseCsvArtists(csv, 5)).toHaveLength(5)
  })
})

describe('createCsvImportAdapter', () => {
  it('has correct type and label', () => {
    const adapter = createCsvImportAdapter()
    expect(adapter.type).toBe('csv-import')
    expect(adapter.label).toBe('CSV Import')
    expect(adapter.configFields).toEqual([])
  })

  it('returns artists from sourceConfig.artists', async () => {
    const adapter = createCsvImportAdapter()
    const result = await adapter.fetch({ artists: ['Radiohead', 'Portishead'] })
    expect(result.artists).toHaveLength(2)
    expect(result.artists[0]).toMatchObject({
      name: 'Radiohead',
      source: 'csv-import',
      similarityScore: 0.8,
    })
  })

  it('returns empty array when no artists in config', async () => {
    const adapter = createCsvImportAdapter()
    const result = await adapter.fetch({})
    expect(result.artists).toEqual([])
  })

  it('respects options.limit', async () => {
    const adapter = createCsvImportAdapter()
    const result = await adapter.fetch({ artists: ['A', 'B', 'C', 'D', 'E'] }, { limit: 3 })
    expect(result.artists).toHaveLength(3)
  })
})
