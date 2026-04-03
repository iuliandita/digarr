import type { AdapterResult, SubscriptionAdapter } from '@/core/subscriptions/types'

const KNOWN_HEADERS = ['artist', 'artist_name', 'artist name', 'name']

/**
 * Parse a CSV string and extract artist names.
 * Detects known header columns; falls back to first column or bare lines.
 */
export function parseCsvArtists(csv: string, maxArtists = 500): string[] {
  const lines = csv
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) return []

  const firstLine = lines[0] as string
  const columns = firstLine.split(',').map((col) => col.trim())
  const headerIdx = columns.findIndex((col) => KNOWN_HEADERS.includes(col.toLowerCase()))

  let artistColumn: number
  let startRow: number

  if (headerIdx !== -1) {
    artistColumn = headerIdx
    startRow = 1
  } else if (columns.length === 1 && !firstLine.includes(',')) {
    artistColumn = 0
    startRow = 0
  } else {
    artistColumn = 0
    startRow = 1
  }

  const seen = new Set<string>()
  const artists: string[] = []

  for (let i = startRow; i < lines.length && artists.length < maxArtists; i++) {
    const cols = (lines[i] as string).split(',')
    const name = (cols[artistColumn] ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    artists.push(name)
  }

  return artists
}

export function createCsvImportAdapter(): SubscriptionAdapter {
  return {
    type: 'csv-import',
    label: 'CSV Import',
    configFields: [],

    async fetch(
      config: Record<string, unknown>,
      options?: { limit?: number },
    ): Promise<AdapterResult> {
      const limit = options?.limit ?? 500
      const names = Array.isArray(config.artists)
        ? (config.artists as unknown[]).filter((n): n is string => typeof n === 'string')
        : []
      return {
        artists: names.slice(0, limit).map((name) => ({
          name,
          similarityScore: 0.8,
          source: 'csv-import',
        })),
      }
    },
  }
}
