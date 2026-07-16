import { useEffect, useState } from 'react'

export function useSSE(url: string) {
  const [data, setData] = useState<unknown>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const source = new EventSource(url)
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
