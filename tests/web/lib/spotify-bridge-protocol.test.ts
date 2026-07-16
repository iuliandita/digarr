import { describe, expect, it } from 'vitest'
import {
  isSpotifyBridgeCommand,
  isSpotifyBridgeEvent,
  isSpotifyBridgeInit,
} from '@/web/lib/spotify-bridge-protocol'

const token = 'test'
const url = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'

describe('Spotify bridge init guard', () => {
  it('accepts the exact init payload', () => {
    expect(isSpotifyBridgeInit({ type: 'spotify-bridge-init', token, url })).toBe(true)
  })

  it.each([
    null,
    { type: 'spotify-bridge-init', token: '', url },
    { type: 'spotify-bridge-init', token: 'x'.repeat(129), url },
    { type: 'spotify-bridge-init', token, url: 'http://open.spotify.com/track/abc' },
    { type: 'spotify-bridge-init', token, url: 'https://open.spotify.com:8443/track/abc' },
    { type: 'spotify-bridge-init', token, url: 'https://evil.example/track/abc' },
    { type: 'spotify-bridge-init', token, url, extra: true },
    Object.assign(Object.create({ inherited: true }), {
      type: 'spotify-bridge-init',
      token,
      url,
    }),
  ])('rejects malformed init payload %#', (value) => {
    expect(isSpotifyBridgeInit(value)).toBe(false)
  })
})

describe('Spotify bridge command guard', () => {
  it.each([
    { type: 'load', token, url },
    { type: 'play', token },
    { type: 'pause', token },
    { type: 'destroy', token },
  ])('accepts command $type', (value) => {
    expect(isSpotifyBridgeCommand(value)).toBe(true)
  })

  it.each([
    { type: 'load', token, url: 'https://open.spotify.com.evil.example/track/abc' },
    { type: 'play', token: '' },
    { type: 'seek', token },
    { type: 'pause', token, url },
    Object.assign(Object.create(null), { type: 'destroy', token }),
  ])('rejects malformed command %#', (value) => {
    expect(isSpotifyBridgeCommand(value)).toBe(false)
  })
})

describe('Spotify bridge event guard', () => {
  it.each([
    { type: 'ready', token },
    { type: 'playback-started', token },
    {
      type: 'playback-state',
      token,
      paused: false,
      buffering: false,
      duration: 30_000,
      position: 10_000,
    },
    { type: 'failure', token },
  ])('accepts event $type', (value) => {
    expect(isSpotifyBridgeEvent(value)).toBe(true)
  })

  it.each([
    { type: 'ready', token, extra: true },
    { type: 'playback-started' },
    {
      type: 'playback-state',
      token,
      paused: false,
      buffering: false,
      duration: Number.POSITIVE_INFINITY,
      position: 0,
    },
    {
      type: 'playback-state',
      token,
      paused: false,
      buffering: false,
      duration: 1,
      position: Number.NaN,
    },
    { type: 'error', token },
  ])('rejects malformed event %#', (value) => {
    expect(isSpotifyBridgeEvent(value)).toBe(false)
  })
})
