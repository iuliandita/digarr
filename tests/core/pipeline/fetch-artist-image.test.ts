// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { RateLimitedError } from '@/core/clients/audiodb'
import { fetchArtistImage } from '@/core/pipeline/resolve'

describe('fetchArtistImage with AudioDB', () => {
  it('returns AudioDB result when MBID lookup hits (AudioDB is primary)', async () => {
    const audiodb = {
      getArtistImages: vi.fn(async () => ({ url: 'adb://thumb' })),
      searchArtistByName: vi.fn(async () => ({})),
    }
    const lidarr = { lookupArtist: vi.fn() }
    const fanart = { getArtistImages: vi.fn() }
    const musicinfo = { lookupArtistImages: vi.fn() }
    const result = await fetchArtistImage('mbid-1', 'Artist', audiodb, lidarr, fanart, musicinfo)
    expect(result.url).toBe('adb://thumb')
    expect(result.failed).toBe(false)
    expect(lidarr.lookupArtist).not.toHaveBeenCalled()
    expect(fanart.getArtistImages).not.toHaveBeenCalled()
  })

  it('cascades to name search when MBID lookup is empty', async () => {
    const audiodb = {
      getArtistImages: vi.fn(async () => ({})),
      searchArtistByName: vi.fn(async () => ({ url: 'adb://name' })),
    }
    const result = await fetchArtistImage('mbid-2', 'Niche Artist', audiodb, null, null, null)
    expect(result.url).toBe('adb://name')
    expect(audiodb.searchArtistByName).toHaveBeenCalledWith('Niche Artist')
  })

  it('cascades to Lidarr on RateLimitedError and skips name search', async () => {
    const audiodb = {
      getArtistImages: vi.fn(async () => {
        throw new RateLimitedError()
      }),
      searchArtistByName: vi.fn(),
    }
    const lidarr = {
      lookupArtist: vi.fn(async () => [
        { images: [{ coverType: 'poster', remoteUrl: 'lidarr://x' }] },
      ]),
    }
    const result = await fetchArtistImage('mbid-3', 'Name', audiodb, lidarr, null, null)
    expect(audiodb.searchArtistByName).not.toHaveBeenCalled()
    expect(result.url).toBe('lidarr://x')
  })

  it('cascades through Lidarr -> fanart -> musicinfo when no AudioDB', async () => {
    const lidarr = { lookupArtist: vi.fn(async () => []) }
    const fanart = { getArtistImages: vi.fn(async () => ({ url: 'fanart://y' })) }
    const result = await fetchArtistImage('mbid-4', 'Y', null, lidarr, fanart, null)
    expect(result.url).toBe('fanart://y')
  })
})
