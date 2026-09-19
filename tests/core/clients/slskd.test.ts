// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSlskdClient,
  SLSKD_MAX_RELEASE_BYTES,
  SLSKD_MAX_RELEASE_FILES,
} from '@/core/clients/slskd'

const mockGet = vi.fn()
const mockPost = vi.fn()
const batchId = '11111111-1111-4111-8111-111111111111'

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
      searchText: 'radiohead paranoid android',
    })
    expect(result).toEqual({ id: 'search-1' })
  })

  it('GETs search results for a search id', async () => {
    mockGet.mockResolvedValueOnce([
      {
        username: 'user1',
        files: [
          {
            filename: 'Radiohead\\OK Computer\\01 - Airbag.flac',
            size: 123456789,
            bitrate: 999,
            extension: 'flac',
          },
          {
            filename: 'Radiohead\\OK Computer\\02 - Paranoid Android.flac',
            size: 223456789,
            extension: 'flac',
          },
        ],
      },
    ])

    const client = createSlskdClient('http://slskd.local:5030', 'test-api-key')
    const result = await client.getSearchResults('search-1')

    expect(mockGet).toHaveBeenCalledWith('/api/v0/searches/search-1/responses')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      filename: 'Radiohead - OK Computer',
      username: 'user1',
      directory: 'Radiohead\\OK Computer',
      directories: ['Radiohead\\OK Computer'],
      size: 346913578,
    })
    expect(result[0]?.files).toHaveLength(2)
  })

  it('groups multi-disc folders into one release manifest', async () => {
    mockGet.mockResolvedValueOnce([
      {
        username: 'peer',
        files: [
          { filename: 'Artist\\Album\\CD 1\\01.flac', size: 100 },
          { filename: 'Artist\\Album\\CD 2\\02.flac', size: 200 },
        ],
      },
    ])

    const result = await createSlskdClient('http://slskd.local:5030', 'key').getSearchResults('s')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      directory: 'Artist\\Album',
      directories: ['Artist\\Album\\CD 1', 'Artist\\Album\\CD 2'],
    })
    expect(result[0]?.files).toHaveLength(2)
  })

  it('drops release manifests that exceed the file-count bound', async () => {
    mockGet.mockResolvedValueOnce([
      {
        username: 'hostile-peer',
        files: Array.from({ length: SLSKD_MAX_RELEASE_FILES + 1 }, (_, index) => ({
          filename: `Artist\\Album\\${index}.flac`,
          size: 1,
        })),
      },
    ])

    const result = await createSlskdClient('http://slskd.local:5030', 'key').getSearchResults('s')

    expect(result).toEqual([])
  })

  it('drops release manifests that exceed the aggregate byte bound', async () => {
    mockGet.mockResolvedValueOnce([
      {
        username: 'hostile-peer',
        files: [
          { filename: 'Artist\\Album\\01.flac', size: SLSKD_MAX_RELEASE_BYTES / 2 + 1 },
          { filename: 'Artist\\Album\\02.flac', size: SLSKD_MAX_RELEASE_BYTES / 2 + 1 },
        ],
      },
    ])

    const result = await createSlskdClient('http://slskd.local:5030', 'key').getSearchResults('s')

    expect(result).toEqual([])
  })

  it('defensively refuses an oversized manifest before enqueue', async () => {
    const client = createSlskdClient('http://slskd.local:5030', 'key')
    const files = Array.from({ length: SLSKD_MAX_RELEASE_FILES + 1 }, (_, index) => ({
      filename: `Artist\\Album\\${index}.flac`,
      size: 1,
    }))

    await expect(
      client.enqueueResult('search-1', {
        id: 'release-1',
        filename: 'Album',
        username: 'hostile-peer',
        files,
        size: files.length,
      }),
    ).rejects.toThrow(/exceeds .* files/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('enqueues the complete selected release as one batch', async () => {
    mockPost.mockResolvedValueOnce({ batch: { id: batchId }, failures: [] })
    const client = createSlskdClient('http://slskd.local:5030', 'key')

    const response = await client.enqueueResult('search-1', {
      id: 'release-1',
      filename: 'Album',
      username: 'peer',
      directory: 'Artist\\Album',
      directories: ['Artist\\Album'],
      files: [
        { filename: 'Artist\\Album\\01.flac', size: 100 },
        { filename: 'Artist\\Album\\02.flac', size: 200 },
      ],
      size: 300,
    })

    expect(response).toEqual({ batch: { id: batchId }, failures: [] })
    expect(mockPost).toHaveBeenCalledWith('/api/v0/transfers/downloads/batches', {
      searchId: 'search-1',
      username: 'peer',
      files: [
        { filename: 'Artist\\Album\\01.flac', size: 100 },
        { filename: 'Artist\\Album\\02.flac', size: 200 },
      ],
      options: {},
    })
  })

  it.each([
    { name: 'missing', response: { failures: [] } },
    { name: 'malformed', response: { batch: { id: 'not-a-uuid' }, failures: [] } },
  ])('rejects a $name batch id in the enqueue response', async ({ response }) => {
    mockPost.mockResolvedValueOnce(response)
    const client = createSlskdClient('http://slskd.local:5030', 'key')

    await expect(
      client.enqueueResult('search-1', {
        id: 'release-1',
        filename: 'Album',
        username: 'peer',
        files: [{ filename: 'Artist\\Album\\01.flac', size: 100 }],
        size: 100,
      }),
    ).rejects.toThrow(/batch|batch id/)
  })

  it('GETs downloads from /api/v0/transfers/downloads', async () => {
    mockGet.mockResolvedValueOnce([
      {
        username: 'user1',
        directories: [
          {
            directory: 'Artist\\Album',
            fileCount: 1,
            files: [
              {
                id: 'download-1',
                username: 'user1',
                state: 'Queued, Remotely',
                filename: 'Artist\\Album\\track.flac',
                size: 100,
              },
            ],
          },
        ],
      },
    ])

    const client = createSlskdClient('http://slskd.local:5030', 'test-api-key')
    const result = await client.getDownloads()

    expect(mockGet).toHaveBeenCalledWith('/api/v0/transfers/downloads')
    expect(result[0]?.directories[0]?.files[0]?.state).toBe('Queued, Remotely')
  })
})
