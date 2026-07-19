export type SpotifyBridgeInit = {
  type: 'spotify-bridge-init'
  token: string
  url: string
}

export type SpotifyBridgeCommand =
  | { type: 'load'; token: string; url: string }
  | { type: 'play'; token: string }
  | { type: 'pause'; token: string }
  | { type: 'destroy'; token: string }

export type SpotifyBridgeEvent =
  | { type: 'ready'; token: string }
  | { type: 'playback-started'; token: string }
  | {
      type: 'playback-state'
      token: string
      paused: boolean
      buffering: boolean
      duration: number
      position: number
    }
  | { type: 'failure'; token: string }

const MAX_TOKEN_LENGTH = 128
const MAX_URL_LENGTH = 2_048

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  if (Object.getPrototypeOf(value) !== Object.prototype) return false

  const ownKeys = Reflect.ownKeys(value)
  return ownKeys.length === keys.length && ownKeys.every((key) => keys.includes(String(key)))
}

function isToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TOKEN_LENGTH &&
    value.trim().length > 0
  )
}

function isSpotifyUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.host === 'open.spotify.com' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

function isPlaybackNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isSpotifyBridgeInit(value: unknown): value is SpotifyBridgeInit {
  return (
    hasExactKeys(value, ['type', 'token', 'url']) &&
    value.type === 'spotify-bridge-init' &&
    isToken(value.token) &&
    isSpotifyUrl(value.url)
  )
}

export function isSpotifyBridgeCommand(value: unknown): value is SpotifyBridgeCommand {
  if (hasExactKeys(value, ['type', 'token'])) {
    return (
      (value.type === 'play' || value.type === 'pause' || value.type === 'destroy') &&
      isToken(value.token)
    )
  }

  return (
    hasExactKeys(value, ['type', 'token', 'url']) &&
    value.type === 'load' &&
    isToken(value.token) &&
    isSpotifyUrl(value.url)
  )
}

export function isSpotifyBridgeEvent(value: unknown): value is SpotifyBridgeEvent {
  if (hasExactKeys(value, ['type', 'token'])) {
    return (
      (value.type === 'ready' || value.type === 'playback-started' || value.type === 'failure') &&
      isToken(value.token)
    )
  }

  return (
    hasExactKeys(value, ['type', 'token', 'paused', 'buffering', 'duration', 'position']) &&
    value.type === 'playback-state' &&
    isToken(value.token) &&
    typeof value.paused === 'boolean' &&
    typeof value.buffering === 'boolean' &&
    isPlaybackNumber(value.duration) &&
    isPlaybackNumber(value.position)
  )
}
