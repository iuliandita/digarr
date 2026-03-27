import { useEffect, useState } from 'react'
import { getStoredToken } from './api'

export function useSSE(url: string) {
  const [data, setData] = useState<unknown>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // EventSource doesn't support custom headers, so pass token as query param
    const token = getStoredToken()
    const separator = url.includes('?') ? '&' : '?'
    const authedUrl = token ? `${url}${separator}token=${encodeURIComponent(token)}` : url
    const source = new EventSource(authedUrl)
    source.onopen = () => setConnected(true)
    source.onmessage = (e) => {
      try {
        setData(JSON.parse(e.data as string) as unknown)
      } catch {
        // Ignore malformed SSE messages (keep-alive pings, partial writes)
      }
    }
    source.onerror = () => setConnected(false)
    return () => source.close()
  }, [url])

  return { data, connected }
}
