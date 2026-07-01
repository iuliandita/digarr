// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sanitizePreferredUsername } from '@/server/routes/oidc'

describe('sanitizePreferredUsername', () => {
  it('accepts alphanumeric and allowed punctuation', () => {
    expect(sanitizePreferredUsername('john.doe_42-x')).toBe('john.doe_42-x')
  })

  it('strips disallowed chars', () => {
    expect(sanitizePreferredUsername('hello world!')).toBe('helloworld')
    expect(sanitizePreferredUsername('user<script>alert(1)</script>')).toBe(
      'userscriptalert1script',
    )
  })

  it('caps at 50 chars', () => {
    const long = 'a'.repeat(100)
    expect(sanitizePreferredUsername(long).length).toBe(50)
  })

  it('passes through empty string', () => {
    expect(sanitizePreferredUsername('')).toBe('')
  })
})
