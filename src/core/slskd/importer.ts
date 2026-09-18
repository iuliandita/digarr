import path from 'node:path'
import type {
  createLidarrClient,
  LidarrManualImportCandidate,
  LidarrManualImportFile,
} from '@/core/clients/lidarr'
import type { SlskdSearchFile } from '@/core/clients/slskd'
import { normalizeAlbumTitle } from '@/core/library/normalize'
import { isSupportedAudioFile } from './audio'

export type SlskdImportRelease = {
  files: SlskdSearchFile[]
}

export type SlskdImportJob = {
  releaseTitle: string
  lidarrArtistId: number | null
  lidarrAlbumId: number | null
}

export type SlskdImportClient = Pick<
  ReturnType<typeof createLidarrClient>,
  'getAlbums' | 'getManualImport' | 'updateManualImport' | 'getTracks'
>

function normalizeInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function remoteDirectory(filename: string): string {
  return filename
    .split(/[\\/]+/)
    .filter(Boolean)
    .slice(0, -1)
    .join('\\')
}

function remoteBasename(filename: string): string {
  return (
    filename
      .split(/[\\/]+/)
      .filter(Boolean)
      .at(-1) ?? ''
  )
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32)
}

function safeLeaf(remotePath: string): string {
  const leaf =
    remotePath
      .split(/[\\/]+/)
      .filter(Boolean)
      .at(-1) ?? ''
  const stem = leaf.split('.')[0]?.toLowerCase() ?? ''
  if (
    !leaf ||
    leaf === '.' ||
    leaf === '..' ||
    hasControlCharacters(leaf) ||
    /[\\/]/.test(leaf) ||
    /[<>:"|?*]/.test(leaf) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem) ||
    /[. ]$/.test(leaf)
  ) {
    throw new Error(`unsafe slskd download directory: ${remotePath}`)
  }
  return leaf
}

function joinVisiblePath(base: string, ...segments: string[]): string {
  const api = /^[a-z]:[\\/]/i.test(base) || base.includes('\\') ? path.win32 : path.posix
  return api.join(base, ...segments)
}

export function mapSlskdReleasePaths(
  selected: SlskdImportRelease,
  lidarrDownloadPath: string,
): { folders: string[]; audioFiles: string[] } {
  const directoryMap = new Map<string, string>()
  const leafOwners = new Map<string, string>()
  for (const file of selected.files) {
    const directory = remoteDirectory(file.filename)
    if (!directory) throw new Error(`slskd result has no remote directory: ${file.filename}`)
    const leaf = safeLeaf(directory)
    const collisionKey = leaf.toLocaleLowerCase('en-US')
    const priorOwner = leafOwners.get(collisionKey)
    if (priorOwner && priorOwner !== directory) {
      throw new Error(`ambiguous slskd directory mapping: ${priorOwner} and ${directory}`)
    }
    leafOwners.set(collisionKey, directory)
    directoryMap.set(directory, joinVisiblePath(lidarrDownloadPath, leaf))
  }

  const localFiles = new Map<string, string>()
  const audioFiles: string[] = []
  for (const file of selected.files) {
    const directory = remoteDirectory(file.filename)
    const basename = remoteBasename(file.filename)
    if (
      !basename ||
      basename === '.' ||
      basename === '..' ||
      hasControlCharacters(basename) ||
      /[<>:"|?*]/.test(basename)
    ) {
      throw new Error(`unsafe slskd filename: ${file.filename}`)
    }
    const localDirectory = directoryMap.get(directory)
    if (!localDirectory) throw new Error(`slskd directory mapping missing for ${directory}`)
    const localPath = joinVisiblePath(localDirectory, basename)
    const collisionKey = localPath.toLocaleLowerCase('en-US')
    const prior = localFiles.get(collisionKey)
    if (prior && prior !== file.filename) {
      throw new Error(`ambiguous slskd file mapping: ${prior} and ${file.filename}`)
    }
    localFiles.set(collisionKey, file.filename)
    if (isSupportedAudioFile(basename)) audioFiles.push(localPath)
  }

  if (audioFiles.length === 0) throw new Error('slskd release has no supported audio files')
  return { folders: [...new Set(directoryMap.values())], audioFiles }
}

function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLocaleLowerCase('en-US')
}

function rejectionMessage(candidate: LidarrManualImportCandidate): string | null {
  const first = candidate.rejections?.[0]
  if (!first) return null
  if (typeof first === 'string') return first
  return first.reason ?? first.message ?? 'unknown rejection'
}

function isAlbumIdentificationRejection(message: string): boolean {
  return (
    /unable to (?:identify|determine|find).*(?:album|release)/i.test(message) ||
    /(?:album|release).*(?:not found|unknown|unidentified)/i.test(message)
  )
}

function validateCandidatePaths(
  candidates: LidarrManualImportCandidate[],
  expectedPaths: Set<string>,
) {
  if (candidates.length === 0) throw new Error('Lidarr found no manual import candidates')
  const candidatePaths = new Set(candidates.map((candidate) => normalizedPath(candidate.path)))
  if (
    candidatePaths.size !== candidates.length ||
    candidatePaths.size !== expectedPaths.size ||
    [...expectedPaths].some((expected) => !candidatePaths.has(expected))
  ) {
    throw new Error('Lidarr manual import candidates do not exactly match the downloaded release')
  }
}

function exactAlbumTitle(value: string): string {
  return normalizeAlbumTitle(value).trim().toLocaleLowerCase('en-US')
}

async function resolveFallbackAlbum(
  job: SlskdImportJob,
  candidates: LidarrManualImportCandidate[],
  expectedFileCount: number,
  lidarr: SlskdImportClient,
): Promise<LidarrManualImportCandidate[]> {
  const albumIds = new Set(
    candidates.flatMap((candidate) => {
      const id = normalizeInteger(candidate.album?.id)
      return id == null ? [] : [id]
    }),
  )
  const missingAlbum = candidates.some((candidate) => normalizeInteger(candidate.album?.id) == null)
  if (!missingAlbum) return candidates
  if (albumIds.size > 0)
    throw new Error('Lidarr manual import returned a mix of identified and unidentified albums')

  const artistIds = new Set(
    candidates.flatMap((candidate) => {
      const id = normalizeInteger(candidate.artist?.id)
      return id == null ? [] : [id]
    }),
  )
  if (
    artistIds.size !== 1 ||
    candidates.some((candidate) => !normalizeInteger(candidate.artist?.id))
  ) {
    throw new Error('Lidarr could not tag-confirm one artist for album fallback')
  }
  const artistId = [...artistIds][0] as number
  if (job.lidarrArtistId != null && artistId !== job.lidarrArtistId) {
    throw new Error('Lidarr tag-confirmed artist does not match the queued artist')
  }
  const title = exactAlbumTitle(job.releaseTitle)
  const matches = (await lidarr.getAlbums(artistId)).filter(
    (album) => exactAlbumTitle(album.title) === title,
  )
  if (matches.length !== 1) {
    throw new Error(`Lidarr album fallback found ${matches.length} exact title matches`)
  }
  const album = matches[0]
  const trackCount = album?.statistics?.trackCount ?? 0
  if (!album || trackCount <= 0 || expectedFileCount < trackCount) {
    throw new Error('Lidarr album fallback does not have enough downloaded files')
  }

  return lidarr.updateManualImport(
    candidates.map((candidate) => ({
      ...candidate,
      artist: { ...candidate.artist, id: artistId },
      album: { ...candidate.album, id: album.id, title: album.title, artistId },
    })),
  )
}

export async function buildLidarrManualImport(
  job: SlskdImportJob,
  selected: SlskdImportRelease,
  lidarrDownloadPath: string,
  lidarr: SlskdImportClient,
): Promise<{
  albumId: number
  expectedTrackIds: number[]
  files: LidarrManualImportFile[]
  alreadyComplete: boolean
}> {
  const mapped = mapSlskdReleasePaths(selected, lidarrDownloadPath)
  const candidateGroups = await Promise.all(
    mapped.folders.map((folder) => lidarr.getManualImport(folder)),
  )
  let candidates = candidateGroups.flat().filter((candidate) => !candidate.additionalFile)

  const expectedPaths = new Set(mapped.audioFiles.map(normalizedPath))
  validateCandidatePaths(candidates, expectedPaths)
  for (const candidate of candidates) {
    const rejection = rejectionMessage(candidate)
    const albumMissing = normalizeInteger(candidate.album?.id) == null
    if (rejection && !(albumMissing && isAlbumIdentificationRejection(rejection))) {
      throw new Error(`Lidarr rejected ${candidate.path}: ${rejection}`)
    }
  }

  candidates = await resolveFallbackAlbum(job, candidates, expectedPaths.size, lidarr)
  validateCandidatePaths(candidates, expectedPaths)
  for (const candidate of candidates) {
    const rejection = rejectionMessage(candidate)
    if (rejection) throw new Error(`Lidarr rejected ${candidate.path}: ${rejection}`)
  }

  const artistIds = new Set(candidates.map((candidate) => normalizeInteger(candidate.artist?.id)))
  const albumIds = new Set(candidates.map((candidate) => normalizeInteger(candidate.album?.id)))
  if (artistIds.size !== 1 || artistIds.has(null)) {
    throw new Error('Lidarr manual import candidates do not resolve to one artist')
  }
  if (albumIds.size !== 1 || albumIds.has(null)) {
    throw new Error('Lidarr manual import candidates do not resolve to one album')
  }
  const artistId = [...artistIds][0] as number
  const albumId = [...albumIds][0] as number
  if (job.lidarrArtistId != null && artistId !== job.lidarrArtistId) {
    throw new Error('Lidarr manual import artist does not match the queued artist')
  }
  if (job.lidarrAlbumId != null && albumId !== job.lidarrAlbumId) {
    throw new Error('Lidarr manual import album does not match the queued album')
  }

  const files = candidates.map((candidate): LidarrManualImportFile => {
    const trackIds = [
      ...new Set(
        (candidate.tracks ?? []).flatMap((track) => {
          const id = normalizeInteger(track.id)
          return id == null ? [] : [id]
        }),
      ),
    ]
    if (trackIds.length === 0) {
      throw new Error(`Lidarr manual import candidate has no tracks: ${candidate.path}`)
    }
    if (!candidate.quality || typeof candidate.quality !== 'object') {
      throw new Error(`Lidarr manual import candidate has no quality: ${candidate.path}`)
    }
    return {
      path: candidate.path,
      artistId,
      albumId,
      trackIds,
      quality: candidate.quality,
      disableReleaseSwitching: false,
    }
  })
  const expectedTrackIds = [...new Set(files.flatMap((file) => file.trackIds))]
  if (expectedTrackIds.length !== files.reduce((count, file) => count + file.trackIds.length, 0)) {
    throw new Error('Lidarr manual import assigns the same track to multiple files')
  }
  const albumTracks = await lidarr.getTracks(albumId)
  if (albumTracks.length === 0) throw new Error('Lidarr album has no tracks to import')
  const albumTrackIds = new Set(albumTracks.map((track) => track.id))
  if (expectedTrackIds.some((id) => !albumTrackIds.has(id))) {
    throw new Error('Lidarr manual import returned tracks from another album')
  }
  const uncovered = albumTracks.filter(
    (track) => !track.hasFile && !expectedTrackIds.includes(track.id),
  )
  if (uncovered.length > 0) {
    throw new Error(`Lidarr manual import is missing ${uncovered.length} album track(s)`)
  }

  return {
    albumId,
    expectedTrackIds,
    files,
    alreadyComplete: expectedTrackIds.every(
      (id) => albumTracks.find((track) => track.id === id)?.hasFile === true,
    ),
  }
}
