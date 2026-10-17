// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { getScoreDistribution } from '@/db/queries/analytics'

describe('getScoreDistribution', () => {
  it('labels the top bucket 90-100% and clamps a score of 1.0 into it in SQL', async () => {
    const execute = vi.fn(async (_query: unknown) => ({
      rows: [
        { bucket_start: 0, count: 1 },
        { bucket_start: 90, count: 3 },
      ],
    }))
    const result = await getScoreDistribution({ execute } as never)

    expect(result).toEqual([
      { bucket: '0-10%', count: 1 },
      { bucket: '90-100%', count: 3 },
    ])
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toContain('LEAST(FLOOR(score * 10), 9)')
  })
})
