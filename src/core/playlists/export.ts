import { cellSafe } from '@/core/csv/cell-safe'
import type { PlaylistExportOutcome } from '@/core/playlists/types'
import { escapeXml } from '@/core/targets/export-xspf'
import type {
  DestinationTarget,
  PlaylistExportSession,
  PlaylistItem,
  PlaylistResult,
} from '@/core/targets/types'
import { errMsg } from '@/core/validation'
import type { Database } from '@/db'
import type { PlaylistExportRow } from '@/db/queries/playlist-exports'
import {
  linkPlaylistExport,
  markPlaylistExportRecoveryRequired,
  reservePlaylistExport,
} from '@/db/queries/playlist-exports'
import type { PlaylistTrackRow } from '@/db/queries/playlists'

export type PlaylistExportFormat = 'json' | 'csv' | 'm3u' | 'xspf'

export type ExportablePlaylistTrack = Pick<
  PlaylistTrackRow,
  'artistName' | 'trackName' | 'mbid' | 'spotifyUri' | 'deezerId' | 'localPath' | 'position'
>

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
        cellSafe(track.artistName),
        cellSafe(track.trackName ?? ''),
        cellSafe(getPlaylistTrackLocation(track)),
        cellSafe(track.mbid ?? ''),
        cellSafe(track.spotifyUri ?? ''),
        cellSafe(track.deezerId ?? ''),
        cellSafe(track.localPath ?? ''),
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

export type SavedPlaylistExportStore = {
  reserve(
    targetId: number,
    scope: string,
  ): Promise<{
    created: boolean
    binding: Pick<PlaylistExportRow, 'remoteScope' | 'remotePlaylistId' | 'state'>
  }>
  link(targetId: number, scope: string, remotePlaylistId: string): Promise<void>
  markRecoveryRequired(targetId: number): Promise<void>
}

export function createSavedPlaylistExportStore(
  db: Database,
  userId: number,
  playlistId: number,
): SavedPlaylistExportStore {
  return {
    reserve: (targetId, scope) => reservePlaylistExport(db, userId, playlistId, targetId, scope),
    link: (targetId, scope, remoteId) =>
      linkPlaylistExport(db, userId, playlistId, targetId, scope, remoteId),
    markRecoveryRequired: (targetId) =>
      markPlaylistExportRecoveryRequired(db, userId, playlistId, targetId),
  }
}

const OUTCOME_ERROR_MAX = 300

async function confirmTrackCount(
  session: PlaylistExportSession,
  result: PlaylistResult,
): Promise<boolean> {
  if (!session.readBackTrackCount || !result.playlistId || result.itemsAdded === undefined)
    return false
  try {
    return (await session.readBackTrackCount(result.playlistId)) === result.itemsAdded
  } catch {
    // A failed read-back leaves the write unverified; it does not change what was submitted.
    return false
  }
}

export async function pushSavedPlaylistToTargets(
  targets: Array<{ targetId: number; target: DestinationTarget; targetName?: string }>,
  name: string,
  items: PlaylistItem[],
  store: SavedPlaylistExportStore,
  reportOutcomes?: (outcomes: PlaylistExportOutcome[]) => Promise<void>,
): Promise<void> {
  const failures: string[] = []
  const outcomes: PlaylistExportOutcome[] = []
  for (const { targetId, target, targetName } of targets) {
    const base = { targetId, targetName: targetName ?? target.name, targetType: target.type }
    let created = false
    let recorded = false
    try {
      if (items.length === 0)
        throw new Error('No generated tracks; the remote playlist was preserved')
      if (!target.openPlaylistExportSession)
        throw new Error('Destination cannot refresh saved playlists')
      const session = await target.openPlaylistExportSession(items)
      const reservation = await store.reserve(targetId, session.scope)
      created = reservation.created
      const { binding } = reservation
      if (binding.remoteScope !== session.scope)
        throw new Error('Destination account or server changed; export recovery is required')

      let result: PlaylistResult
      if (created) {
        let checkpointedId: string | undefined
        result = await session.createPlaylist(name, async (remotePlaylistId) => {
          if (checkpointedId) throw new Error('Playlist identity was already checkpointed')
          await store.link(targetId, session.scope, remotePlaylistId)
          checkpointedId = remotePlaylistId
        })
        if (!checkpointedId || result.playlistId !== checkpointedId) {
          throw new Error(
            `${result.error ? `${result.error}; ` : ''}Remote playlist identity was not confirmed; export recovery is required`,
          )
        }
      } else {
        if (binding.state !== 'linked' || !binding.remotePlaylistId)
          throw new Error('Remote playlist creation is unresolved; export recovery is required')
        result = await session.replacePlaylist(binding.remotePlaylistId, name)
      }
      if (!result.success) throw new Error(result.error || 'Export failed')
      const skipped = result.itemsSkipped ?? 0
      outcomes.push({
        ...base,
        status: skipped > 0 ? 'partial' : 'submitted',
        verified: await confirmTrackCount(session, result),
        itemsAdded: result.itemsAdded,
        itemsSkipped: skipped,
      })
      recorded = true
      if (skipped > 0) throw new Error(`Added ${result.itemsAdded ?? 0}, skipped ${skipped}`)
    } catch (error) {
      let message = errMsg(error)
      if (created) {
        try {
          await store.markRecoveryRequired(targetId)
        } catch (checkpointError) {
          message += `; recovery state could not be persisted: ${errMsg(checkpointError)}`
        }
      }
      if (!recorded) {
        outcomes.push({
          ...base,
          status: 'failed',
          verified: false,
          error: message.slice(0, OUTCOME_ERROR_MAX),
        })
      }
      failures.push(`${target.type}(${targetId}): ${message}`)
    }
  }
  if (reportOutcomes) {
    try {
      await reportOutcomes(outcomes)
    } catch (error) {
      failures.push(`export outcomes could not be saved: ${errMsg(error)}`)
    }
  }
  if (failures.length > 0) throw new Error(`Playlist export failed: ${failures.join('; ')}`)
}
