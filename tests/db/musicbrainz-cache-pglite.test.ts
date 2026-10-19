// @vitest-environment node
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMusicBrainzClient } from '@/core/clients/musicbrainz'
import { createReleaseGroupCache } from '@/core/clients/release-group-cache'
import { createMusicBrainzCacheStore } from '@/db/queries/musicbrainz-cache'
import { musicbrainzCache } from '@/db/schema'
import { makeTestDb } from '../helpers/test-db'

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 })

vi.mock('p-queue', () => ({
  default: class {
    add(fn: () => unknown) {
      return fn()
    }
  },
}))
vi.mock('@/core/sleep', () => ({ sleep: async () => {} }))

const MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
const DAY = 24 * 60 * 60 * 1000
const upstream = vi.fn()
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

function respond(url: string): Response {
  if (url.includes('/release-group?')) {
    return json({
      'release-groups': [
        { id: 'rg-1', title: 'One', 'primary-type': 'Album', 'secondary-types': [] },
      ],
      'release-group-count': 1,
      'release-group-offset': 0,
    })
  }
  if (url.includes('/recording?')) return json({ recordings: [{ id: 'rec-1', title: 'Song' }] })
  return json({ id: MBID, name: 'Radiohead' })
}

let testDb: Awaited<ReturnType<typeof makeTestDb>>
let clock = Date.parse('2026-10-01T00:00:00Z')

beforeEach(async () => {
  testDb = await makeTestDb()
  clock = Date.parse('2026-10-01T00:00:00Z')
  upstream.mockReset()
  upstream.mockImplementation(async (url: string) => respond(url))
  vi.stubGlobal('fetch', upstream)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await testDb.close()
})

// A new client with an empty in-memory release-group cache stands in for a pod restart.
function freshClient(releaseGroupCache = createReleaseGroupCache({ now: () => clock })) {
  return createMusicBrainzClient({
    releaseGroupCache,
    cacheStore: createMusicBrainzCacheStore(testDb.db as never, { now: () => clock }),
  })
}

async function lookupAll(client: ReturnType<typeof freshClient>) {
  await client.lookupArtist(MBID)
  await client.getReleaseGroups(MBID)
  await client.getRecordings(MBID)
}

describe('persistent MusicBrainz cache (PGlite)', () => {
  it('serves artist, release groups and recordings from the DB after a restart', async () => {
    await lookupAll(freshClient())
    expect(upstream).toHaveBeenCalledTimes(3)

    const restarted = freshClient()
    await expect(restarted.lookupArtist(MBID)).resolves.toMatchObject({ name: 'Radiohead' })
    await expect(restarted.getReleaseGroups(MBID)).resolves.toEqual([
      { id: 'rg-1', title: 'One', type: 'Album', secondaryTypes: [], firstReleaseDate: undefined },
    ])
    await expect(restarted.getRecordings(MBID)).resolves.toEqual([
      { id: 'rec-1', title: 'Song', isrcs: undefined },
    ])
    expect(upstream).toHaveBeenCalledTimes(3)
  })

  it('refetches once an entry expires and prunes expired rows', async () => {
    await lookupAll(freshClient())
    clock += 8 * DAY
    await lookupAll(freshClient())
    // Release groups expire after a day; artist and recordings last 30.
    expect(upstream).toHaveBeenCalledTimes(4)

    clock += 30 * DAY
    await lookupAll(freshClient())
    expect(upstream).toHaveBeenCalledTimes(7)

    clock += 60 * DAY
    await createMusicBrainzCacheStore(testDb.db as never, { now: () => clock }).prune()
    expect(await testDb.db.select().from(musicbrainzCache)).toEqual([])
  })

  it('keeps release groups no staler than 24h, even when memory is refilled from the DB', async () => {
    await freshClient().getReleaseGroups(MBID)
    clock += 20 * 60 * 60 * 1000
    const restarted = freshClient()
    await restarted.getReleaseGroups(MBID)
    expect(upstream).toHaveBeenCalledTimes(1)

    // The memory entry filled at hour 20 expires with the DB row at hour 24, not hour 44.
    clock += 5 * 60 * 60 * 1000
    await restarted.getReleaseGroups(MBID)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('a forced refresh skips cached reads and writes the fresh result to both layers', async () => {
    const memory = createReleaseGroupCache({ now: () => clock })
    const client = freshClient(memory)
    await client.searchArtist('radiohead')
    await client.getReleaseGroups(MBID)
    expect(upstream).toHaveBeenCalledTimes(2)

    upstream.mockImplementation(async (url: string) =>
      url.includes('/release-group?')
        ? json({
            'release-groups': [
              { id: 'rg-2', title: 'Two', 'primary-type': 'Album', 'secondary-types': [] },
            ],
            'release-group-count': 1,
            'release-group-offset': 0,
          })
        : json({ artists: [{ id: MBID, name: 'Radiohead', score: 100 }] }),
    )
    await client.searchArtist('radiohead', { bypassCache: true })
    await client.getReleaseGroups(MBID, undefined, { bypassCache: true })
    expect(upstream).toHaveBeenCalledTimes(4)

    // Same memory cache and a restarted client both see the post-refresh data without fetching.
    expect((await client.getReleaseGroups(MBID)).map((g) => g.id)).toEqual(['rg-2'])
    const restarted = freshClient()
    expect((await restarted.searchArtist('radiohead')).artists).toHaveLength(1)
    expect((await restarted.getReleaseGroups(MBID)).map((g) => g.id)).toEqual(['rg-2'])
    expect(upstream).toHaveBeenCalledTimes(4)
  })

  it('never caches transient failures but remembers a 404 for a day', async () => {
    upstream.mockImplementation(async () => new Response('', { status: 503 }))
    await expect(freshClient().lookupArtist(MBID)).rejects.toThrow('HTTP 503')
    expect(await testDb.db.select().from(musicbrainzCache)).toEqual([])

    upstream.mockReset()
    upstream.mockImplementation(async () => new Response('', { status: 404 }))
    await expect(freshClient().lookupArtist(MBID)).rejects.toThrow('HTTP 404')
    await expect(freshClient().lookupArtist(MBID)).rejects.toThrow('HTTP 404')
    expect(upstream).toHaveBeenCalledTimes(1)

    clock += DAY + 1
    upstream.mockImplementation(async (url: string) => respond(url))
    await expect(freshClient().lookupArtist(MBID)).resolves.toMatchObject({ name: 'Radiohead' })
  })

  it('migration 0063 is safe to re-run', async () => {
    const statements = readFileSync('drizzle/0063_musicbrainz_cache.sql', 'utf8').split(
      '--> statement-breakpoint',
    )
    for (let run = 0; run < 2; run += 1) {
      for (const statement of statements) await testDb.db.execute(sql.raw(statement))
    }
    await freshClient().lookupArtist(MBID)
    expect(await testDb.db.select().from(musicbrainzCache)).toHaveLength(1)
  })
})
