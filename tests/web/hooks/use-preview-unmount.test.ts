// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreview } from '@/web/hooks/use-preview'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

class FakeAudio {
  static instances: FakeAudio[] = []
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  volume = 1
  src: string
  pause = vi.fn()
  play = vi.fn(() => Promise.resolve())
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(I18nProvider, null, children)

const deezerResponse = {
  ok: true,
  json: async () => ({
    data: [
      {
        id: 1,
        name: 'Radiohead',
        preview: 'https://cdn.example/p.mp3',
        title: 'Creep',
        artist: { id: 1, name: 'Radiohead' },
      },
    ],
  }),
}

describe('usePreview unmount', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    vi.stubGlobal('Audio', FakeAudio)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pauses playing audio on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(deezerResponse))
    const { result, unmount } = renderHook(() => usePreview(), { wrapper })
    await act(async () => {
      await result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    const audio = FakeAudio.instances[0]
    expect(audio?.pause).not.toHaveBeenCalled()
    unmount()
    expect(audio?.pause).toHaveBeenCalled()
  })

  it('does not start playback when a pending lookup resolves after unmount', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
      ),
    )
    const { result, unmount } = renderHook(() => usePreview(), { wrapper })
    let pending: Promise<string> | undefined
    act(() => {
      pending = result.current.play('m1', 'Radiohead', { deezer: 'url' })
    })
    unmount()
    resolveFetch(deezerResponse)
    expect(await pending).toBe('superseded')
    expect(FakeAudio.instances).toHaveLength(0)
  })
})
