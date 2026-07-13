// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createTestApp } from '../helpers/test-app'

describe('content security policy', () => {
  it('allows the Spotify iframe controller script from the same trusted host as embeds', async () => {
    const { app } = createTestApp()

    const response = await app.request('/api/v1/auth/status')
    const policy = response.headers.get('content-security-policy')

    expect(policy).toContain(
      "script-src 'self' https://open.spotify.com/embed/iframe-api/v1 https://embed-cdn.spotifycdn.com/_next/static/",
    )
    expect(policy).toContain("frame-src 'self' https://open.spotify.com")
  })
})
