import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampVolume,
  DEFAULT_PREVIEW_VOLUME,
  PREVIEW_VOLUME_KEY,
  readStoredVolume,
  writeStoredVolume,
} from '@/web/lib/preview-volume'

describe('clampVolume', () => {
  it('clamps to the [0, 1] range', () => {
    expect(clampVolume(-0.5)).toBe(0)
    expect(clampVolume(0)).toBe(0)
    expect(clampVolume(0.42)).toBe(0.42)
    expect(clampVolume(1)).toBe(1)
    expect(clampVolume(2)).toBe(1)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_PREVIEW_VOLUME)
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PREVIEW_VOLUME)
  })
})

describe('readStoredVolume / writeStoredVolume', () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the default when nothing is stored', () => {
    expect(readStoredVolume()).toBe(DEFAULT_PREVIEW_VOLUME)
  })

  it('round-trips a clamped value', () => {
    writeStoredVolume(0.3)
    expect(store[PREVIEW_VOLUME_KEY]).toBe('0.3')
    expect(readStoredVolume()).toBe(0.3)
  })

  it('clamps out-of-range stored values on read', () => {
    store[PREVIEW_VOLUME_KEY] = '5'
    expect(readStoredVolume()).toBe(1)
  })

  it('returns the default for an unparseable stored value', () => {
    store[PREVIEW_VOLUME_KEY] = 'loud'
    expect(readStoredVolume()).toBe(DEFAULT_PREVIEW_VOLUME)
  })
})
