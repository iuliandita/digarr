#!/usr/bin/env bun

/**
 * Import artist metadata from a CSV file into the artist_metadata table.
 *
 * Usage: bun scripts/import-artist-metadata.ts <csv-file>
 *
 * Expected CSV columns: artist_name,spotify_genres,spotify_popularity,deezer_fans
 * Genres column: pipe-separated (e.g. "indie rock|shoegaze|dream pop")
 *
 * Rows are upserted by normalized artist name (lowercase, trimmed).
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { closeDb, db } from '../src/db'
import type { ArtistMetadataInsert } from '../src/db/queries/artist-metadata'
import { bulkUpsert, getCount } from '../src/db/queries/artist-metadata'

const BATCH_SIZE = 500
const PROGRESS_INTERVAL = 10_000

const file = process.argv[2]
if (!file) {
  console.error('Usage: bun scripts/import-artist-metadata.ts <csv-file>')
  process.exit(1)
}

const rl = createInterface({
  input: createReadStream(file),
  crlfDelay: Number.POSITIVE_INFINITY,
})

let lineNum = 0
let skipped = 0
let imported = 0
let batch: ArtistMetadataInsert[] = []
let headerParsed = false
let colMap: Record<string, number> = {}

function parseHeader(line: string): Record<string, number> {
  const cols = line.split(',').map((c) => c.trim().toLowerCase())
  const map: Record<string, number> = {}
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]
    if (col) map[col] = i
  }
  return map
}

function parseLine(line: string): ArtistMetadataInsert | null {
  // Handle quoted CSV fields (basic -- handles commas inside quotes)
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)

  const nameIdx = colMap.artist_name ?? colMap.name ?? 0
  const genresIdx = colMap.spotify_genres ?? colMap.genres ?? 1
  const popIdx = colMap.spotify_popularity ?? colMap.popularity ?? 2
  const fansIdx = colMap.deezer_fans ?? colMap.fans ?? 3

  const name = fields[nameIdx]?.trim()
  if (!name) return null

  const genresRaw = fields[genresIdx]?.trim()
  const spotifyGenres = genresRaw
    ? genresRaw
        .split('|')
        .map((g) => g.trim())
        .filter(Boolean)
    : null
  const popRaw = fields[popIdx]?.trim()
  const spotifyPopularity = popRaw ? parseInt(popRaw, 10) : null
  const fansRaw = fields[fansIdx]?.trim()
  const deezerFans = fansRaw ? parseInt(fansRaw, 10) : null

  return {
    name,
    nameNormalized: name.toLowerCase(),
    spotifyGenres: spotifyGenres?.length ? spotifyGenres : null,
    spotifyPopularity: Number.isNaN(spotifyPopularity) ? null : spotifyPopularity,
    deezerFans: Number.isNaN(deezerFans) ? null : deezerFans,
  }
}

async function flushBatch() {
  if (batch.length === 0) return
  const count = await bulkUpsert(db as never, batch)
  imported += count
  batch = []
}

for await (const line of rl) {
  lineNum++

  if (!headerParsed) {
    colMap = parseHeader(line)
    headerParsed = true
    continue
  }

  const row = parseLine(line)
  if (!row) {
    skipped++
    continue
  }

  batch.push(row)
  if (batch.length >= BATCH_SIZE) {
    await flushBatch()
  }

  if (lineNum % PROGRESS_INTERVAL === 0) {
    console.log(`  processed ${lineNum} lines (${imported} imported, ${skipped} skipped)`)
  }
}

await flushBatch()

const totalInDb = await getCount(db as never)
console.log(`Done. ${imported} rows imported, ${skipped} skipped. Total in DB: ${totalInDb}`)

await closeDb()
