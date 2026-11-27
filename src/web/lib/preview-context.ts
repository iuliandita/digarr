import { createContext, useContext } from 'react'
import type { ApplePreviewsPreference } from '../hooks/use-apple-previews'
import type { AuditionQueue } from '../hooks/use-audition-queue'
import type { PreviewSource } from '../hooks/use-preview'

type PreviewContextValue = {
  play: (mbid: string, artistName: string, streamingUrls: Record<string, string> | null) => void
  stop: () => void
  hasPreview: (streamingUrls: Record<string, string> | null) => boolean
  currentMbid: string | null
  currentTrack?: PreviewSource['track']
  playing: boolean
  globalPlayId: number
  volume: number
  setVolume: (value: number) => void
  audition: AuditionQueue
  /**
   * The user's `applePreviews` preference: 'on' takes inline players from
   * Apple, never Spotify; 'unknown' (still loading or failed) shows neither.
   * Treated as 'off' when absent.
   */
  applePreviews?: ApplePreviewsPreference
}

export const PreviewContext = createContext<PreviewContextValue | null>(null)

export function usePreviewContext() {
  const ctx = useContext(PreviewContext)
  if (!ctx) throw new Error('usePreviewContext must be used within PreviewContext.Provider')
  return ctx
}
