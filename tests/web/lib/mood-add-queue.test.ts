import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/web/lib/api'
import {
  createMoodAddQueue,
  MAX_ATTEMPTS,
  type MoodAddFailure,
  PIPELINE_RETRY_MS,
} from '@/web/lib/mood-add-queue'

function setup(send: (name: string) => Promise<unknown>) {
  const queue = createMoodAddQueue(send)
  const added = vi.fn()
  const failed = vi.fn<(reason: MoodAddFailure, err: unknown) => void>()
  const add = (name: string) => queue.enqueue(name, { onAdded: added, onFailed: failed })
  return { queue, added, failed, add }
}

describe('mood add queue (#1109)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits for Retry-After after a 429, then retries the same artist', async () => {
    const send = vi
      .fn<(name: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError(429, { title: 'Too many requests' }, 20))
      .mockResolvedValue({ message: 'ok' })
    const { queue, added, failed, add } = setup(send)

    add('Burial')
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)
    expect(queue.getSnapshot().get('Burial')).toBe('queued')

    await vi.advanceTimersByTimeAsync(19_000)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith('Burial')
    expect(added).toHaveBeenCalledTimes(1)
    expect(failed).not.toHaveBeenCalled()
    expect(queue.getSnapshot().get('Burial')).toBe('added')
  })

  it('caps a huge Retry-After at 90 seconds', async () => {
    const send = vi
      .fn<(name: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError(429, {}, 3600))
      .mockResolvedValue({})
    const { added, add } = setup(send)

    add('Autechre')
    await vi.advanceTimersByTimeAsync(90_000)
    expect(added).toHaveBeenCalledTimes(1)
  })

  it('sends one request at a time, in order', async () => {
    let release: () => void = () => {}
    const send = vi
      .fn<(name: string) => Promise<unknown>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockResolvedValue({})
    const { queue, add } = setup(send)

    add('A')
    add('B')
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)
    expect(queue.getSnapshot().get('A')).toBe('sending')
    expect(queue.getSnapshot().get('B')).toBe('queued')

    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(send.mock.calls.map(([n]) => n)).toEqual(['A', 'B'])
  })

  it('retries a 409 every 15s and gives up after the attempt cap', async () => {
    const send = vi
      .fn<(name: string) => Promise<unknown>>()
      .mockRejectedValue(new ApiError(409, { title: 'A pipeline run is already in progress' }))
    const { queue, added, failed, add } = setup(send)

    add('Nils Frahm')
    await vi.advanceTimersByTimeAsync(PIPELINE_RETRY_MS * MAX_ATTEMPTS)

    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    expect(added).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledTimes(1)
    expect(failed.mock.calls[0]?.[0]).toBe('pipeline-running')
    expect(queue.getSnapshot().has('Nils Frahm')).toBe(false)
  })

  it('does not retry other errors and reports them immediately', async () => {
    const send = vi
      .fn<(name: string) => Promise<unknown>>()
      .mockRejectedValue(new ApiError(404, { title: 'Not found' }))
    const { queue, failed, add } = setup(send)

    add('Nobody')
    await vi.advanceTimersByTimeAsync(0)

    expect(send).toHaveBeenCalledTimes(1)
    expect(failed).toHaveBeenCalledWith('other', expect.any(ApiError))
    expect(queue.getSnapshot().has('Nobody')).toBe(false)
  })

  it('never queues the same artist twice', async () => {
    const send = vi.fn<(name: string) => Promise<unknown>>().mockResolvedValue({})
    const { added, add } = setup(send)

    expect(add('Burial')).toBe(true)
    expect(add('Burial')).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(add('Burial')).toBe(false)

    expect(send).toHaveBeenCalledTimes(1)
    expect(added).toHaveBeenCalledTimes(1)
  })
})
