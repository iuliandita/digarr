// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/db'
import { enrichImages, resetListeningImageCache } from '@/server/routes/listening-images'

const deps = { lidarrUrl: 'http://lidarr.test', lidarrApiKey: 'key', skipTlsVerify: false }
const mbid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const poster = (url: string) => [{ images: [{ coverType: 'poster', remoteUrl: url }] }]

function fakeDb(rows: Array<{ mbid: string; imageUrl: string | null }>): Database {
  return {
    select: () => ({ from: () => ({ where: async () => rows }) }),
  } as unknown as Database
}

describe('listening image enrichment', () => {
  beforeEach(() => resetListeningImageCache())

  it('uses an image already stored for the MBID without calling Lidarr', async () => {
    const lookup = vi.fn(async () => poster('http://remote/a'))
    const entries = [{ artist: 'A', mbid: mbid(1) }]
    await enrichImages(fakeDb([{ mbid: mbid(1), imageUrl: 'http://db/a' }]), entries, deps, lookup)
    expect(entries[0]).toMatchObject({ imageUrl: 'http://db/a' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('keeps remote lookups to 4 in flight', async () => {
    let active = 0
    let max = 0
    const lookup = vi.fn(async (term: string) => {
      active++
      max = Math.max(max, active)
      await sleep(10)
      active--
      return poster(`http://remote/${term}`)
    })
    const entries = Array.from({ length: 12 }, (_, i) => ({ artist: `A${i}`, mbid: mbid(i) }))
    await enrichImages(fakeDb([]), entries, deps, lookup)
    expect(max).toBe(4)
    expect(entries.every((e) => 'imageUrl' in e)).toBe(true)
  })

  it('serves a repeat request from the cache', async () => {
    const lookup = vi.fn(async () => poster('http://remote/a'))
    const first = [{ artist: 'A', mbid: mbid(1) }]
    const second = [{ artist: 'A', mbid: mbid(1) }]
    await enrichImages(fakeDb([]), first, deps, lookup)
    await enrichImages(fakeDb([]), second, deps, lookup)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(second[0]).toMatchObject({ imageUrl: 'http://remote/a' })
  })

  it('does not cache a failed lookup', async () => {
    const lookup = vi
      .fn<(term: string) => Promise<unknown[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(poster('http://remote/a'))
    const first = [{ artist: 'A', mbid: mbid(1) }]
    const second = [{ artist: 'A', mbid: mbid(1) }]
    await enrichImages(fakeDb([]), first, deps, lookup)
    expect(first[0]).not.toHaveProperty('imageUrl')
    await enrichImages(fakeDb([]), second, deps, lookup)
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(second[0]).toMatchObject({ imageUrl: 'http://remote/a' })
  })
})
