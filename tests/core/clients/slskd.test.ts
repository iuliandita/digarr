// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSlskdClient } from '@/core/clients/slskd'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('@/core/clients/http', () => ({
  createHttpClient: vi.fn(() => ({
    get: mockGet,
    post: mockPost,
    put: vi.fn(),
    delete: vi.fn(),
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createSlskdClient', () => {
  it('creates an HTTP client with the API key header', async () => {
    const { createHttpClient } = await import('@/core/clients/http')

    createSlskdClient('http://slskd.local:5030', 'test-api-key')

    expect(createHttpClient).toHaveBeenCalledOnce()
    const config = vi.mocked(createHttpClient).mock.calls[0]?.[0]
    expect(config?.baseUrl).toBe('http://slskd.local:5030')
    expect(config?.headers?.['X-API-KEY']).toBe('test-api-key')
  })

  it('tests the application info endpoint', async () => {
    mockGet.mockResolvedValueOnce({ version: '1.0.0' })

    const client = createSlskdClient('http://slskd.local:5030', 'test-api-key')
    await expect(client.testConnection()).resolves.toMatchObject({
      success: true,
    })

    expect(mockGet).toHaveBeenCalledWith('/api/v0/application')
  })

  it('POSTs searches to /api/v0/searches', async () => {
    mockPost.mockResolvedValueOnce({ id: 'search-1' })

    const client = createSlskdClient('http://slskd.local:5030', 'test-api-key')
    const result = await client.createSearch('radiohead paranoid android')

    expect(mockPost).toHaveBeenCalledWith('/api/v0/searches', {
      queryText: 'radiohead paranoid android',
    })
    expect(result).toEqual({ id: 'search-1' })
  })

  it('GETs search results for a search id', async () => {
    mockGet.mockResolvedValueOnce([
      {
        id: 'result-1',
        filename: 'Radiohead - Paranoid Android.flac',
        username: 'user1',
        size: 123456789,
        bitrate: 999,
        extension: 'flac',
      },
    ])

    const client = createSlskdClient('http://slskd.local:5030', 'test-api-key')
    const result = await client.getSearchResults('search-1')

    expect(mockGet).toHaveBeenCalledWith('/api/v0/searches/search-1/results')
    expect(result).toEqual([
      {
        id: 'result-1',
        filename: 'Radiohead - Paranoid Android.flac',
        username: 'user1',
        size: 123456789,
        bitrate: 999,
        extension: 'flac',
      },
    ])
  })

  it('GETs downloads from /api/v0/transfers/downloads', async () => {
    mockGet.mockResolvedValueOnce([
      {
        id: 'download-1',
        username: 'user1',
        state: 'queued',
        directory: '/downloads',
        filename: 'track.flac',
      },
    ])

    const client = createSlskdClient('http://slskd.local:5030', 'test-api-key')
    const result = await client.getDownloads()

    expect(mockGet).toHaveBeenCalledWith('/api/v0/transfers/downloads')
    expect(result).toEqual([
      {
        id: 'download-1',
        username: 'user1',
        state: 'queued',
        directory: '/downloads',
        filename: 'track.flac',
      },
    ])
  })
})
