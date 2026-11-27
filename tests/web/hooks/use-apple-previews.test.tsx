// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApplePreviews } from '@/web/hooks/use-apple-previews'
import { getCurrentUser, getUserPreferences } from '@/web/lib/api'
import { createTestQueryClient } from '../helpers/query'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/web/lib/api', () => ({
  getCurrentUser: vi.fn(),
  getUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}))

function renderPreference() {
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useApplePreviews(), { wrapper })
}

describe('useApplePreviews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 1, username: 'u' } as never)
  })

  it('is unknown and pending until the preferences arrive', async () => {
    let resolvePrefs: (value: Record<string, unknown>) => void = () => {}
    vi.mocked(getUserPreferences).mockReturnValue(
      new Promise((resolve) => {
        resolvePrefs = resolve
      }),
    )
    const { result } = renderPreference()
    expect(result.current).toMatchObject({ preference: 'unknown', pending: true, enabled: false })
    await waitFor(() => expect(getUserPreferences).toHaveBeenCalled())
    expect(result.current.preference).toBe('unknown')

    resolvePrefs({ applePreviews: true })
    await waitFor(() => expect(result.current.preference).toBe('on'))
    expect(result.current).toMatchObject({ pending: false, enabled: true })
  })

  it('is off once preferences load without the opt-in', async () => {
    vi.mocked(getUserPreferences).mockResolvedValue({})
    const { result } = renderPreference()
    await waitFor(() => expect(result.current.preference).toBe('off'))
    expect(result.current.pending).toBe(false)
  })

  it('stays unknown, no longer pending, when preferences fail to load', async () => {
    vi.mocked(getUserPreferences).mockRejectedValue(new Error('down'))
    const { result } = renderPreference()
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.preference).toBe('unknown')
  })

  it('stays unknown, no longer pending, without a signed-in user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const { result } = renderPreference()
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.preference).toBe('unknown')
    expect(getUserPreferences).not.toHaveBeenCalled()
  })
})
