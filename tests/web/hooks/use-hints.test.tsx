// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useHints } from '@/web/hooks/use-hints'
import { getUserPreferences, updateUserPreferences } from '@/web/lib/api'

vi.mock('@/web/lib/api', () => ({
  getUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}))

describe('useHints', () => {
  it('brings dismissed tips back and saves the empty list', async () => {
    vi.mocked(getUserPreferences).mockResolvedValue({ dismissedHints: ['a', 'b'] } as Awaited<
      ReturnType<typeof getUserPreferences>
    >)
    vi.mocked(updateUserPreferences).mockResolvedValue(undefined as never)
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useHints(), { wrapper })
    await waitFor(() => expect(result.current.dismissedCount).toBe(2))
    expect(result.current.isHintDismissed('a')).toBe(true)

    await act(() => result.current.resetHints())

    expect(updateUserPreferences).toHaveBeenCalledWith({ dismissedHints: [] })
    await waitFor(() => expect(result.current.dismissedCount).toBe(0))
    expect(result.current.isHintDismissed('a')).toBe(false)
  })

  it('rolls back the reset when the save fails', async () => {
    vi.mocked(getUserPreferences).mockResolvedValue({ dismissedHints: ['a', 'b'] } as Awaited<
      ReturnType<typeof getUserPreferences>
    >)
    vi.mocked(updateUserPreferences).mockRejectedValue(new Error('boom'))
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useHints(), { wrapper })
    await waitFor(() => expect(result.current.dismissedCount).toBe(2))

    await act(async () => {
      await expect(result.current.resetHints()).rejects.toThrow('boom')
    })

    expect(result.current.dismissedCount).toBe(2)
    expect(result.current.isHintDismissed('a')).toBe(true)
  })
})
