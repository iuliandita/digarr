// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createListenBrainzClient } from '@/core/clients/listenbrainz'

const mockGet = vi.fn()

vi.mock('@/core/clients/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/clients/http')>()
  return {
    ...actual,
    createHttpClient: vi.fn(() => ({
      get: mockGet,
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    })),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getTagRadio(tags, options)', () => {
  it('sends single tag without parens or weight', async () => {
    mockGet.mockResolvedValueOnce([])
    const client = createListenBrainzClient('testuser', 'my-token')
    await client.getTagRadio([{ tag: 'jazz', weight: 1 }])
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('tag=jazz'))
    // No parens for single tag
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining('(jazz)'))
  })

  it('assembles multi-tag expression with weights', async () => {
    mockGet.mockResolvedValueOnce([])
    const client = createListenBrainzClient('testuser', 'my-token')
    await client.getTagRadio([
      { tag: 'trip hop', weight: 2 },
      { tag: 'ambient', weight: 1 },
    ])
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('tag=%28trip+hop%29%3A2%3A%28ambient%29%3A1'),
    )
  })

  it('passes count, pop_begin, pop_end as query params', async () => {
    mockGet.mockResolvedValueOnce([])
    const client = createListenBrainzClient('testuser', 'my-token')
    await client.getTagRadio([{ tag: 'rock', weight: 1 }], { count: 10, popBegin: 20, popEnd: 80 })
    const url = mockGet.mock.calls[0]?.[0] as string
    expect(url).toContain('count=10')
    expect(url).toContain('pop_begin=20')
    expect(url).toContain('pop_end=80')
  })

  it('defaults count=25, pop_begin=0, pop_end=100', async () => {
    mockGet.mockResolvedValueOnce([])
    const client = createListenBrainzClient('testuser', 'my-token')
    await client.getTagRadio([{ tag: 'rock', weight: 1 }])
    const url = mockGet.mock.calls[0]?.[0] as string
    expect(url).toContain('count=25')
    expect(url).toContain('pop_begin=0')
    expect(url).toContain('pop_end=100')
  })

  it('maps LB response to TagRadioRecording[]', async () => {
    mockGet.mockResolvedValueOnce([
      { recording_mbid: 'rec-1', percent: 100, source: 'artist', tag_count: 9 },
      { recording_mbid: 'rec-2', percent: 45.5, source: 'release-group', tag_count: 3 },
    ])
    const client = createListenBrainzClient('testuser', 'my-token')
    const result = await client.getTagRadio([{ tag: 'jazz', weight: 1 }])
    expect(result).toEqual([
      { recordingMbid: 'rec-1', percent: 100, source: 'artist', tagCount: 9 },
      { recordingMbid: 'rec-2', percent: 45.5, source: 'release-group', tagCount: 3 },
    ])
  })

  it('returns empty array for empty LB response', async () => {
    mockGet.mockResolvedValueOnce([])
    const client = createListenBrainzClient('testuser', 'my-token')
    const result = await client.getTagRadio([{ tag: 'obscure', weight: 1 }])
    expect(result).toEqual([])
  })
})
