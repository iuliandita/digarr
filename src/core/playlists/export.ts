import type { PlaylistTrackRow } from '@/db/queries/playlists'

export type PlaylistExportFormat = 'json' | 'csv' | 'm3u' | 'xspf'

export type ExportablePlaylistTrack = Pick<
  PlaylistTrackRow,
  'artistName' | 'trackName' | 'mbid' | 'spotifyUri' | 'deezerId' | 'localPath' | 'position'
>

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value
  }
  return `"${value.replaceAll('"', '""')}"`
}

function spotifyTrackUrl(uri: string): string {
  const match = /^spotify:track:(.+)$/.exec(uri)
  return match ? `https://open.spotify.com/track/${match[1]}` : uri
}

function fallbackSearchUrl(track: ExportablePlaylistTrack): string {
  const query = [track.artistName, track.trackName].filter(Boolean).join(' ')
  return `https://musicbrainz.org/search?query=${encodeURIComponent(query)}&type=recording&method=indexed`
}

export function getPlaylistTrackLocation(track: ExportablePlaylistTrack): string {
  if (track.localPath) return track.localPath
  if (track.spotifyUri) return spotifyTrackUrl(track.spotifyUri)
  if (track.deezerId) return `https://www.deezer.com/track/${track.deezerId}`
  if (track.mbid) return `https://musicbrainz.org/recording/${track.mbid}`
  return fallbackSearchUrl(track)
}

function getTrackTitle(track: ExportablePlaylistTrack): string {
  return track.trackName?.trim() || track.artistName
}

function getTrackLabel(track: ExportablePlaylistTrack): string {
  return `${track.artistName} - ${getTrackTitle(track)}`
}

export function exportPlaylistToJson(tracks: ExportablePlaylistTrack[]): string {
  return JSON.stringify(
    tracks.map((track) => ({
      position: track.position,
      artistName: track.artistName,
      trackName: track.trackName,
      mbid: track.mbid,
      spotifyUri: track.spotifyUri,
      deezerId: track.deezerId,
      localPath: track.localPath,
      location: getPlaylistTrackLocation(track),
    })),
    null,
    2,
  )
}

export function exportPlaylistToCsv(tracks: ExportablePlaylistTrack[]): string {
  const lines = [
    'position,artist,track,location,mbid,spotifyUri,deezerId,localPath',
    ...tracks.map((track) =>
      [
        track.position,
        escapeCsv(track.artistName),
        escapeCsv(track.trackName ?? ''),
        escapeCsv(getPlaylistTrackLocation(track)),
        escapeCsv(track.mbid ?? ''),
        escapeCsv(track.spotifyUri ?? ''),
        escapeCsv(track.deezerId ?? ''),
        escapeCsv(track.localPath ?? ''),
      ].join(','),
    ),
  ]

  return lines.join('\n')
}

export function exportPlaylistToM3u(tracks: ExportablePlaylistTrack[]): string {
  const lines = ['#EXTM3U']

  for (const track of tracks) {
    lines.push(`#EXTINF:-1,${getTrackLabel(track)}`)
    lines.push(getPlaylistTrackLocation(track))
  }

  return lines.join('\n')
}

export function exportPlaylistToXspf(
  tracks: ExportablePlaylistTrack[],
  options?: { title?: string; creator?: string },
): string {
  const title = options?.title ?? 'Digarr Playlist'
  const creator = options?.creator ?? 'Digarr'
  const sortedTracks = tracks.slice().sort((a, b) => a.position - b.position)

  const trackList = sortedTracks
    .map((track) =>
      [
        '    <track>',
        `      <location>${escapeXml(getPlaylistTrackLocation(track))}</location>`,
        `      <creator>${escapeXml(track.artistName)}</creator>`,
        `      <title>${escapeXml(getTrackTitle(track))}</title>`,
        track.mbid
          ? `      <identifier>${escapeXml(`https://musicbrainz.org/recording/${track.mbid}`)}</identifier>`
          : null,
        '    </track>',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<playlist version="1" xmlns="http://xspf.org/ns/0/">',
    `  <title>${escapeXml(title)}</title>`,
    `  <creator>${escapeXml(creator)}</creator>`,
    tracks.length === 0 ? '  <trackList/>' : '  <trackList>',
    trackList,
    tracks.length === 0 ? null : '  </trackList>',
    '</playlist>',
  ]
    .filter(Boolean)
    .join('\n')
}
