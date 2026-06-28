// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { redactUrlForLog } from '@/core/clients/http'

describe('redactUrlForLog', () => {
  it('redacts ?token= values', () => {
    const result = redactUrlForLog('https://example.com/hook?token=SECRETVAL')
    expect(result).not.toContain('SECRETVAL')
    expect(result).toContain('REDACTED')
  })

  it('redacts ?auth= values (new key)', () => {
    const result = redactUrlForLog('https://example.com/hook?auth=AUTHSECRET')
    expect(result).not.toContain('AUTHSECRET')
    expect(result).toContain('REDACTED')
  })

  it('is case-insensitive on key matching (?Token=)', () => {
    const result = redactUrlForLog('https://example.com/hook?Token=MYTOKEN')
    expect(result).not.toContain('MYTOKEN')
    expect(result).toContain('REDACTED')
  })

  it('masks userinfo username and password', () => {
    const result = redactUrlForLog('https://user:pass@host.example.com/path')
    expect(result).not.toContain('user')
    expect(result).not.toContain('pass')
    expect(result).toContain('REDACTED')
  })

  it('redacts a non-empty url fragment', () => {
    const result = redactUrlForLog('https://example.com/hook?ok=1#token=SECRET')
    expect(result).not.toContain('SECRET')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts two sensitive params in one url', () => {
    const result = redactUrlForLog('https://example.com/hook?token=AAA&secret=BBB')
    expect(result).not.toContain('AAA')
    expect(result).not.toContain('BBB')
    expect(result).toContain('REDACTED')
  })

  it('leaves non-sensitive query params intact (?user=test)', () => {
    const result = redactUrlForLog('https://example.com/hook?user=test&foo=bar')
    expect(result).toContain('user=test')
    expect(result).toContain('foo=bar')
  })

  it('returns a plain url with no secrets unchanged', () => {
    const url = 'https://example.com/api/webhook'
    expect(redactUrlForLog(url)).toBe(url)
  })
})
