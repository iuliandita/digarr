import { describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from '@/web/lib/format-time'

describe('formatRelativeTime', () => {
  it('formats past timestamps with the requested locale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T10:00:00.000Z'))

    expect(formatRelativeTime('it', '2026-04-12T08:00:00.000Z')).toBe(
      new Intl.RelativeTimeFormat('it', { numeric: 'auto' }).format(-2, 'hour'),
    )
  })

  it('returns the fallback for missing timestamps', () => {
    expect(formatRelativeTime('it', null)).toBe('-')
  })
})
