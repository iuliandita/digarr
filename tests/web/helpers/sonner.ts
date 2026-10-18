import { type Mock, vi } from 'vitest'

// Use inside a hoisted factory: vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())
export function sonnerMock(): { Toaster: () => null; toast: Record<string, Mock> } {
  return {
    Toaster: () => null,
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
}
