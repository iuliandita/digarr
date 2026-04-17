// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { maybeAutoLink, sanitizePreferredUsername } from '@/server/routes/oidc'

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

describe('maybeAutoLink', () => {
  it('refuses auto-link when OIDC_TRUST_EMAIL_VERIFIED=false', () => {
    expect(maybeAutoLink({ email: 'x@y.z', emailVerified: true }, false)).toBeNull()
  })

  it('refuses auto-link when email_verified claim is absent or false', () => {
    expect(maybeAutoLink({ email: 'x@y.z' }, true)).toBeNull()
    expect(maybeAutoLink({ email: 'x@y.z', emailVerified: false }, true)).toBeNull()
  })

  it('refuses auto-link when email missing', () => {
    expect(maybeAutoLink({ emailVerified: true }, true)).toBeNull()
  })

  it('allows auto-link when gate open and both claims present', () => {
    expect(maybeAutoLink({ email: 'x@y.z', emailVerified: true }, true)).toBe('x@y.z')
  })
})
