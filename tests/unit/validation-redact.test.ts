// @vitest-environment node

import { expect, it, vi } from 'vitest'
import { logAndSanitize } from '@/core/validation'

it('redacts postgres credentials before logging', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  logAndSanitize(new Error('connect failed: postgres://user:s3cret@host:5432/db'), 'migrate-test')
  const logged = spy.mock.calls.flat().map(String).join(' ')
  expect(logged).not.toContain('s3cret')
  expect(logged).toContain('postgres://user:***@host')
  spy.mockRestore()
})
