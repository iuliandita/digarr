type TrackSearchCandidate = {
  id: string
  title: string
  artists: string[]
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function pickBestTrackMatch(
  items: TrackSearchCandidate[],
  artistName: string,
  trackName: string,
): string | null {
  const normalizedArtist = normalize(artistName)
  const normalizedTrack = normalize(trackName)
  if (!normalizedArtist || !normalizedTrack) return null

  const exact = items.find((item) => {
    const titleMatch = normalize(item.title) === normalizedTrack
    const artistMatch = item.artists.some((artist) => normalize(artist) === normalizedArtist)
    return titleMatch && artistMatch
  })

  return exact?.id ?? null
}
