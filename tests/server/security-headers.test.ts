// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createTestApp } from '../helpers/test-app'

function directive(policy: string, name: string): string | undefined {
  return policy
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name} `))
}

describe('content security policy', () => {
  it('keeps remote scripts out of the authenticated application document', async () => {
    const { app } = createTestApp()

    const response = await app.request('/api/v1/auth/status')
    const policy = response.headers.get('content-security-policy') ?? ''

    expect(directive(policy, 'script-src')).toBe("script-src 'self'")
    expect(policy).toContain("frame-src 'self' https://open.spotify.com")
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  it('scopes Spotify controller access to the same-origin bridge page', async () => {
    const { app } = createTestApp()

    const response = await app.request('/spotify-embed-bridge.html')
    const policy = response.headers.get('content-security-policy') ?? ''

    expect(directive(policy, 'script-src')).toBe(
      "script-src 'self' https://open.spotify.com/embed/iframe-api/v1 https://embed-cdn.spotifycdn.com/_next/static/",
    )
    expect(directive(policy, 'frame-src')).toBe('frame-src https://open.spotify.com')
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'self'")
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })
})
