import { useQuery } from '@tanstack/react-query'
import { getPopularAlbumsAvailability } from '../lib/api'

/**
 * True when at least one popularity source (Spotify OAuth or a Last.fm API key)
 * is connected, so the approve menu can gate the "Popular albums" option.
 * Defaults to enabled while loading; the backend still validates on approve.
 */
export function usePopularAlbumsAvailability(): boolean {
  const { data } = useQuery({
    queryKey: ['popular-albums-availability'],
    queryFn: getPopularAlbumsAvailability,
    staleTime: 5 * 60 * 1000,
  })
  return data?.available ?? true
}
