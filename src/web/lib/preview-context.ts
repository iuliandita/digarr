import { createContext, useContext } from 'react'
import type { AuditionQueue } from '../hooks/use-audition-queue'

type PreviewContextValue = {
  play: (mbid: string, artistName: string, streamingUrls: Record<string, string> | null) => void
  stop: () => void
  hasPreview: (streamingUrls: Record<string, string> | null) => boolean
  currentMbid: string | null
  playing: boolean
  globalPlayId: number
  volume: number
  setVolume: (value: number) => void
  audition: AuditionQueue
}

export const PreviewContext = createContext<PreviewContextValue | null>(null)

export function usePreviewContext() {
  const ctx = useContext(PreviewContext)
  if (!ctx) throw new Error('usePreviewContext must be used within PreviewContext.Provider')
  return ctx
}
