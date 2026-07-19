// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSSE } from '@/web/lib/hooks'

const close = vi.fn()
const MockEventSource = vi.fn(function (this: EventSource, _url: string) {
  this.close = close
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => 'legacy-session-token'),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  })
  vi.stubGlobal('EventSource', MockEventSource)
})

it('opens the exact same-origin SSE URL without a token query', () => {
  const { unmount } = renderHook(() => useSSE('/api/v1/pipeline/events'))

  expect(MockEventSource).toHaveBeenCalledWith('/api/v1/pipeline/events')
  expect(String(MockEventSource.mock.calls[0]?.[0])).not.toContain('token=')

  unmount()
  expect(close).toHaveBeenCalledTimes(1)
})
