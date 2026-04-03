import { createContext, useContext } from 'react'

type PreviewContextValue = {
  play: (mbid: string, artistName: string, streamingUrls: Record<string, string> | null) => void
  stop: () => void
  hasPreview: (streamingUrls: Record<string, string> | null) => boolean
  currentMbid: string | null
  playing: boolean
  globalPlayId: number
}

export const PreviewContext = createContext<PreviewContextValue | null>(null)

export function usePreviewContext() {
  const ctx = useContext(PreviewContext)
  if (!ctx) throw new Error('usePreviewContext must be used within PreviewContext.Provider')
  return ctx
}
