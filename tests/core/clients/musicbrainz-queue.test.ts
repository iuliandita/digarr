// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// This suite uses the REAL p-queue (no mock) plus fake timers to prove the
// rate-gate's timing contract: the backoff sleep of a retrying request lives
// OUTSIDE the single concurrency slot, so it cannot stall other MB traffic.

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubEnv('DIGARR_MUSICBRAINZ_URL', undefined)
  vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', undefined)
  vi.useFakeTimers()
  vi.setSystemTime(0) // anchor Date.now() so fetch timestamps are relative to t=0
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('MusicBrainz shared queue timing (real p-queue)', () => {
  it.each([
    [undefined, undefined, 1000],
    ['http://mirror.example/ws/2', '25', 25],
  ])('shares the configured interval across clients (%s, %s)', async (url, interval, expected) => {
    vi.setSystemTime(1)
    vi.stubEnv('DIGARR_MUSICBRAINZ_URL', url)
    vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', interval)
    vi.resetModules()
    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')
    const times: number[] = []
    mockFetch.mockImplementation(async () => {
      times.push(Date.now())
      return jsonOk({ artists: [] })
    })
    const requests = [
      createMusicBrainzClient().searchArtist('A'),
      createMusicBrainzClient().searchArtist('B'),
    ]
    await vi.advanceTimersByTimeAsync(expected * 2)
    await Promise.all(requests)
    expect(times).toEqual([1, expected + 1])
  })

  it('keeps one in-flight request across clients when the mirror interval is zero', async () => {
    vi.stubEnv('DIGARR_MUSICBRAINZ_URL', 'http://mirror.example/ws/2')
    vi.stubEnv('DIGARR_MUSICBRAINZ_INTERVAL_MS', '0')
    vi.resetModules()
    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')
    let releaseFirst: (response: Response) => void = () => {
      throw new Error('First fetch did not start')
    }
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          releaseFirst = resolve
        }),
    )
    mockFetch.mockResolvedValue(jsonOk({ artists: [] }))
    const requests = [
      createMusicBrainzClient().searchArtist('A'),
      createMusicBrainzClient().searchArtist('B'),
    ]
    await vi.advanceTimersByTimeAsync(0)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    releaseFirst(jsonOk({ artists: [] }))
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(requests)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(Date.now()).toBe(0)
  })

  it('a retrying request does not block other queued traffic for its full backoff', async () => {
    // Fresh module load so the shared queue is constructed under fake timers.
    vi.resetModules()
    const { createMusicBrainzClient } = await import('@/core/clients/musicbrainz')

    const fetches: Array<{ query: string; t: number }> = []
    mockFetch.mockImplementation(async (url: string) => {
      const query = new URL(url).searchParams.get('query') ?? ''
      const seenForQuery = fetches.filter((f) => f.query === query).length
      fetches.push({ query, t: Date.now() })
      // Caller A's first attempt fails transiently (forces a backoff + retry);
      // every other fetch (A's retry, all of B) succeeds.
      if (query === 'AAA' && seenForQuery === 0) {
        return new Response('', { status: 503 })
      }
      return jsonOk({ artists: [] })
    })

    const client = createMusicBrainzClient()
    const pA = client.searchArtist('AAA') // 503 then retry
    const pB = client.searchArtist('BBB') // succeeds

    await vi.advanceTimersByTimeAsync(5000)
    await Promise.all([pA, pB])

    const aFirst = fetches.find((f) => f.query === 'AAA')
    const aRetry = fetches.filter((f) => f.query === 'AAA')[1]
    const b = fetches.find((f) => f.query === 'BBB')

    expect(aFirst?.t).toBe(0)
    expect(b).toBeDefined()
    expect(aRetry).toBeDefined()
    // B runs one queue interval after A's first attempt (~1s), NOT after A's
    // whole retry/backoff cycle. Pre-fix it was stuck behind A at ~2s+.
    expect(b?.t).toBeLessThan(1500)
    // And B is served before A's retry fetch (A's ~1s backoff is spent outside
    // the slot). Pre-fix, A held the slot through its in-slot sleep, so B's
    // fetch could not run until A's whole retry cycle finished -> b.t >= aRetry.t.
    expect(b?.t).toBeLessThan(aRetry?.t ?? Number.POSITIVE_INFINITY)
  })
})
