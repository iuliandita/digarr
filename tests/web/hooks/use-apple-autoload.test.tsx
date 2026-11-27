// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppleAutoload } from '@/web/hooks/use-apple-autoload'
import { getUserPreferences, updateUserPreferences } from '@/web/lib/api'
import { createTestQueryClient } from '../helpers/query'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({
  getUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}))

describe('useAppleAutoload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateUserPreferences).mockResolvedValue({})
  })

  it('reads and saves only appleAutoloadDashboard, never the Spotify preference', async () => {
    vi.mocked(getUserPreferences).mockResolvedValue({ spotifyAutoloadDashboard: true })
    const client = createTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useAppleAutoload(), { wrapper })
    await waitFor(() => expect(getUserPreferences).toHaveBeenCalled())
    expect(result.current.enabled).toBe(false)

    act(() => result.current.setEnabled(true))
    await waitFor(() => expect(result.current.enabled).toBe(true))
    expect(updateUserPreferences).toHaveBeenCalledExactlyOnceWith({ appleAutoloadDashboard: true })
    expect(client.getQueryData(['user-preferences'])).toEqual({
      spotifyAutoloadDashboard: true,
      appleAutoloadDashboard: true,
    })
  })
})
