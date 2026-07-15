import PQueue from 'p-queue'
import type { MBArtist, MBSearchResult } from '@/core/clients/musicbrainz'
import { isMaintenance } from '@/core/ops/maintenance'
import type { TopArtistEntry } from '@/core/plugins/types'
import { redactSecrets } from '@/core/providers/retry'
import type { GenreCoverage } from '@/core/types'
import { isValidMbid } from '@/core/validation'

export const GENRE_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000
export const GENRE_WARM_LIMIT = 10

export type ArtistGenreCacheEntry = {
  mbid: string
  name: string
  genres: string[] | null
  cachedAt: Date | null
}

export type ArtistGenreAliasCacheEntry = ArtistGenreCacheEntry & {
  source: string
  nameNormalized: string
}

export type GenreBackfillDb = {
  getArtistGenreCacheByMbids(mbids: string[]): Promise<ArtistGenreCacheEntry[]>
  getArtistGenreCacheByAliases(
    aliases: Array<{ source: string; nameNormalized: string }>,
  ): Promise<ArtistGenreAliasCacheEntry[]>
  upsertArtistGenres(data: { mbid: string; name: string; genres: string[] }): Promise<unknown>
  upsertArtistGenreAlias(data: {
    source: string
    nameNormalized: string
    mbid: string
  }): Promise<unknown>
}

export type LibraryGenreEntry = {
  mbid: string | null
  name: string
  source: string
  genres: string[] | null
}

type MusicBrainzGenreClient = {
  lookupArtist(mbid: string): Promise<MBArtist>
  searchArtist(query: string): Promise<MBSearchResult>
}

type LastFmGenreClient = {
  getArtistGenres(artistName: string, mbid?: string): Promise<string[]>
}

function artistKey(name: string): string {
  return name.trim().toLowerCase()
}

function sourceNameKey(source: string, name: string): string {
  return `${source}:${artistKey(name)}`
}

function hasGenres(genres: string[] | null | undefined): genres is string[] {
  return Array.isArray(genres) && genres.length > 0
}

function isFresh(entry: ArtistGenreCacheEntry, now: Date): boolean {
  return entry.cachedAt !== null && now.getTime() - entry.cachedAt.getTime() < GENRE_CACHE_TTL_MS
}

function cacheEntryIsPending(entry: ArtistGenreCacheEntry | undefined, now: Date): boolean {
  if (!entry || entry.genres === null) return true
  return !isFresh(entry, now)
}

function mergeLibraryGenres(rows: LibraryGenreEntry[]): LibraryGenreEntry | undefined {
  if (rows.length === 0) return undefined
  const first = rows[0]
  if (!first) return undefined
  return {
    ...first,
    genres: [...new Set(rows.flatMap((row) => row.genres ?? []))],
  }
}

export async function hydrateArtistGenres(
  artists: TopArtistEntry[],
  db: Pick<GenreBackfillDb, 'getArtistGenreCacheByMbids' | 'getArtistGenreCacheByAliases'>,
  libraryArtists: LibraryGenreEntry[],
  now = new Date(),
): Promise<{ artists: TopArtistEntry[]; coverage: GenreCoverage }> {
  const mbids = [...new Set(artists.map((artist) => artist.mbid).filter(isValidMbid))]
  const aliases = artists
    .filter((artist) => !isValidMbid(artist.mbid))
    .map((artist) => ({ source: artist.source, nameNormalized: artistKey(artist.name) }))
  const [cacheRows, aliasCacheRows] = await Promise.all([
    mbids.length > 0 ? db.getArtistGenreCacheByMbids(mbids) : [],
    aliases.length > 0 ? db.getArtistGenreCacheByAliases(aliases) : [],
  ])
  const cacheByMbid = new Map(cacheRows.map((row) => [row.mbid, row]))
  const cacheByAlias = new Map(
    aliasCacheRows.map((row) => [sourceNameKey(row.source, row.nameNormalized), row]),
  )
  const libraryByMbidGroups = new Map<string, LibraryGenreEntry[]>()
  const libraryBySourceNameGroups = new Map<string, LibraryGenreEntry[]>()
  for (const libraryArtist of libraryArtists) {
    if (isValidMbid(libraryArtist.mbid)) {
      const matches = libraryByMbidGroups.get(libraryArtist.mbid) ?? []
      matches.push(libraryArtist)
      libraryByMbidGroups.set(libraryArtist.mbid, matches)
    }
    const sourceName = sourceNameKey(libraryArtist.source, libraryArtist.name)
    const nameMatches = libraryBySourceNameGroups.get(sourceName) ?? []
    nameMatches.push(libraryArtist)
    libraryBySourceNameGroups.set(sourceName, nameMatches)
  }
  const libraryByMbid = new Map(
    [...libraryByMbidGroups.entries()].map(([mbid, rows]) => [mbid, mergeLibraryGenres(rows)]),
  )
  const libraryBySourceName = new Map(
    [...libraryBySourceNameGroups.entries()]
      .filter(([, rows]) => rows.length === 1)
      .map(([key, rows]) => [key, rows[0]]),
  )

  let coveredArtists = 0
  let pendingArtists = 0
  const hydrated = artists.map((artist) => {
    if (hasGenres(artist.genres)) {
      coveredArtists++
      return { ...artist, genreSource: artist.genreSource ?? ('native' as const) }
    }

    const library =
      (isValidMbid(artist.mbid) ? libraryByMbid.get(artist.mbid) : undefined) ??
      libraryBySourceName.get(sourceNameKey(artist.source, artist.name))
    if (hasGenres(library?.genres)) {
      coveredArtists++
      return { ...artist, genres: library.genres, genreSource: 'library' as const }
    }

    const cached = isValidMbid(artist.mbid)
      ? cacheByMbid.get(artist.mbid)
      : cacheByAlias.get(sourceNameKey(artist.source, artist.name))
    if (hasGenres(cached?.genres)) {
      coveredArtists++
      if (cacheEntryIsPending(cached, now)) pendingArtists++
      return { ...artist, genres: cached.genres, genreSource: 'artist-cache' as const }
    }

    if (cacheEntryIsPending(cached, now)) pendingArtists++
    return artist
  })

  return {
    artists: hydrated,
    coverage: { coveredArtists, pendingArtists, totalArtists: artists.length },
  }
}

const warmQueue = new PQueue({ concurrency: 1 })

export async function waitForGenreWarmers(): Promise<void> {
  await warmQueue.onIdle()
}

export type GenreWarmResult = {
  attempted: number
  updated: number
  failed: number
  skippedAmbiguous: number
}

export async function warmArtistGenres(
  artists: TopArtistEntry[],
  options: {
    db: GenreBackfillDb
    musicbrainz: MusicBrainzGenreClient
    lastfm?: LastFmGenreClient
    now?: Date
    limit?: number
  },
): Promise<GenreWarmResult> {
  const emptyResult: GenreWarmResult = {
    attempted: 0,
    updated: 0,
    failed: 0,
    skippedAmbiguous: 0,
  }
  if (isMaintenance()) return emptyResult

  return (await warmQueue.add(async () => {
    const result = { ...emptyResult }
    if (isMaintenance()) return result

    const now = options.now ?? new Date()
    const mbids = [...new Set(artists.map((artist) => artist.mbid).filter(isValidMbid))]
    const aliases = artists
      .filter((artist) => !isValidMbid(artist.mbid))
      .map((artist) => ({ source: artist.source, nameNormalized: artistKey(artist.name) }))
    const [cacheRows, aliasCacheRows] = await Promise.all([
      mbids.length > 0 ? options.db.getArtistGenreCacheByMbids(mbids) : [],
      aliases.length > 0 ? options.db.getArtistGenreCacheByAliases(aliases) : [],
    ])
    const cacheByMbid = new Map(cacheRows.map((row) => [row.mbid, row]))
    const cacheByAlias = new Map(
      aliasCacheRows.map((row) => [sourceNameKey(row.source, row.nameNormalized), row]),
    )
    const eligible = artists
      .filter((artist) => artist.genreSource !== 'native' && artist.genreSource !== 'library')
      .filter((artist) => {
        const cached = isValidMbid(artist.mbid)
          ? cacheByMbid.get(artist.mbid)
          : cacheByAlias.get(sourceNameKey(artist.source, artist.name))
        return cacheEntryIsPending(cached, now)
      })
      .slice(0, options.limit ?? GENRE_WARM_LIMIT)

    for (const artist of eligible) {
      if (isMaintenance()) break
      result.attempted++

      try {
        let mbid = isValidMbid(artist.mbid) ? artist.mbid : undefined
        const resolvedFromName = mbid === undefined
        if (!mbid) {
          const search = await options.musicbrainz.searchArtist(artist.name)
          const exact = search.artists.filter(
            (candidate) => artistKey(candidate.name) === artistKey(artist.name),
          )
          if (exact.length !== 1) {
            result.skippedAmbiguous++
            continue
          }
          mbid = exact[0]?.id
          if (!isValidMbid(mbid)) {
            result.skippedAmbiguous++
            continue
          }
        }

        const resolved = await options.musicbrainz.lookupArtist(mbid)
        const canonicalName = resolved.name.trim()
        if (!canonicalName) throw new Error('MusicBrainz returned an empty artist name')
        let genres = (resolved.tags ?? [])
          .filter((tag) => tag.count > 0)
          .map((tag) => tag.name.trim())
          .filter(Boolean)

        if ((genres?.length ?? 0) === 0 && options.lastfm) {
          genres = await options.lastfm.getArtistGenres(artist.name, mbid)
        }

        if (isMaintenance()) break
        await options.db.upsertArtistGenres({
          mbid,
          name: canonicalName,
          genres,
        })
        if (resolvedFromName) {
          await options.db.upsertArtistGenreAlias({
            source: artist.source,
            nameNormalized: artistKey(artist.name),
            mbid,
          })
        }
        result.updated++
      } catch (error) {
        result.failed++
        console.warn(
          `[genre-backfill] ${artist.name}: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
        )
      }
    }

    return result
  })) as GenreWarmResult
}
