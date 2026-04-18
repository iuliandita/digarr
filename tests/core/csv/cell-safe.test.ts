// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cellSafe, parseCell, parseCsvRow } from '@/core/csv/cell-safe'

describe('cellSafe (export-side sanitization)', () => {
  it('strips leading formula-trigger characters', () => {
    expect(cellSafe('=HYPERLINK(...)')).toBe('HYPERLINK(...)')
    expect(cellSafe('+SUM(...)')).toBe('SUM(...)')
    expect(cellSafe('-1,2,3')).toBe('"1,2,3"')
    expect(cellSafe('@evil')).toBe('evil')
    expect(cellSafe('\tevil')).toBe('evil')
    expect(cellSafe('\revil')).toBe('evil')
  })

  it('strips repeated formula-trigger prefixes', () => {
    expect(cellSafe('==bad')).toBe('bad')
    expect(cellSafe('=+@bad')).toBe('bad')
  })

  it('quotes cells containing comma, quote, or newline', () => {
    expect(cellSafe('a, b')).toBe('"a, b"')
    expect(cellSafe('line1\nline2')).toBe('"line1\nline2"')
    expect(cellSafe('has "quote"')).toBe('"has ""quote"""')
  })

  it('passes through safe input unchanged', () => {
    expect(cellSafe('Artist Name')).toBe('Artist Name')
    expect(cellSafe('')).toBe('')
    expect(cellSafe('simple123')).toBe('simple123')
  })
})

describe('parseCell (import-side sanitization)', () => {
  it('unquotes and de-escapes RFC 4180 quoted fields', () => {
    expect(parseCell('"a, b"')).toBe('a, b')
    expect(parseCell('"a ""b"" c"')).toBe('a "b" c')
    expect(parseCell('"line1\nline2"')).toBe('line1\nline2')
  })

  it('strips formula-trigger prefixes after unquoting', () => {
    expect(parseCell('=bad')).toBe('bad')
    expect(parseCell('"=HYPERLINK(evil)"')).toBe('HYPERLINK(evil)')
    expect(parseCell('+risk')).toBe('risk')
  })

  it('passes through plain fields', () => {
    expect(parseCell('Radiohead')).toBe('Radiohead')
    expect(parseCell('')).toBe('')
  })
})

describe('parseCsvRow (RFC 4180)', () => {
  it('splits simple comma-separated fields', () => {
    expect(parseCsvRow('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('respects quoted commas', () => {
    expect(parseCsvRow('"a,b",c')).toEqual(['a,b', 'c'])
  })

  it('handles escaped quotes in quoted fields', () => {
    expect(parseCsvRow('"a ""b"" c",d')).toEqual(['a "b" c', 'd'])
  })

  it('strips formula prefix on each field', () => {
    expect(parseCsvRow('=evil,safe')).toEqual(['evil', 'safe'])
  })
})

describe('CSV round-trip with hostile input', () => {
  it('strips formula injection on import and does not regenerate it on export', async () => {
    const { parseCsvArtists } = await import('@/core/subscriptions/adapters/csv-import')
    const { exportToCsv } = await import('@/core/targets/export-csv')

    const hostile = '=HYPERLINK("http://evil","click")'
    const csvIn = `artist,notes\n"${hostile.replace(/"/g, '""')}",ok\n`
    const imported = parseCsvArtists(csvIn)
    expect(imported).toHaveLength(1)
    const first = imported[0]
    if (!first) throw new Error('expected at least one imported artist')
    expect(first.startsWith('=')).toBe(false)
    expect(first).toBe('HYPERLINK("http://evil","click")')

    const exported = exportToCsv([
      {
        artistName: first,
        artistMbid: 'mbid-1',
        genres: [],
        score: 0.5,
        status: 'approved',
        streamingUrls: {},
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])
    const dataRow = exported.split('\n')[1]
    if (!dataRow) throw new Error('expected exported row')
    expect(dataRow.startsWith('=')).toBe(false)
    expect(dataRow.startsWith('+')).toBe(false)
    expect(dataRow.startsWith('-')).toBe(false)
    expect(dataRow.startsWith('@')).toBe(false)
  })
})
