import { createHash } from 'node:crypto'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

export type SlskdSearchFile = {
  filename: string
  size: number
  bitrate?: number
  extension?: string
}

export type SlskdSearchResult = {
  id: string
  filename: string
  username: string
  directory?: string
  directories?: string[]
  files?: SlskdSearchFile[]
  size: number
  bitrate?: number
  extension?: string
}

export type SlskdTransferFile = {
  id: string
  batchId?: string | null
  username: string
  filename: string
  size: number
  state: string
  exception?: string | null
}

export type SlskdDownloadDirectory = {
  directory: string
  fileCount: number
  files: SlskdTransferFile[]
}

export type SlskdDownloadUser = {
  username: string
  directories: SlskdDownloadDirectory[]
}

export type SlskdEnqueueResponse = {
  batch: {
    id: string
  }
  failures: Array<{ filename: string; message: string }>
}

type SlskdSearchResponse = {
  username?: unknown
  files?: unknown
}

export const SLSKD_MAX_RELEASE_FILES = 500
export const SLSKD_MAX_RELEASE_BYTES = 20 * 1024 * 1024 * 1024
const SLSKD_MAX_REMOTE_PATH_LENGTH = 2048
const SLSKD_MAX_SEARCH_FILES = 10_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asSearchFile(value: unknown): SlskdSearchFile | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (
    typeof row.filename !== 'string' ||
    !row.filename.trim() ||
    row.filename.length > SLSKD_MAX_REMOTE_PATH_LENGTH
  ) {
    return null
  }
  if (typeof row.size !== 'number' || !Number.isFinite(row.size) || row.size <= 0) return null

  return {
    filename: row.filename,
    size: row.size,
    ...(typeof row.bitrate === 'number' ? { bitrate: row.bitrate } : {}),
    ...(typeof row.extension === 'string' ? { extension: row.extension } : {}),
  }
}

function splitRemotePath(filename: string): string[] {
  return filename.split(/[\\/]+/).filter(Boolean)
}

function remoteDirectory(filename: string): string {
  return splitRemotePath(filename).slice(0, -1).join('\\')
}

function isDiscDirectory(name: string): boolean {
  return /^(?:cd|disc|disk|part)\s*[-_.]?\s*\d+$/i.test(name.trim())
}

function releaseDirectory(filename: string): string {
  const parts = splitRemotePath(filename).slice(0, -1)
  if (parts.length > 1 && isDiscDirectory(parts.at(-1) ?? '')) {
    parts.pop()
  }
  return parts.join('\\')
}

function releaseId(username: string, directory: string): string {
  return createHash('sha256').update(`${username}\0${directory}`).digest('hex')
}

function releaseLabel(directory: string): string {
  const parts = splitRemotePath(directory)
  const title = parts.at(-1) ?? directory
  if (/\s[-–—]\s/.test(title)) return title
  const artist = parts.at(-2)
  return artist ? `${artist} - ${title}` : title
}

function mapSearchResponses(raw: unknown): SlskdSearchResult[] {
  if (!Array.isArray(raw)) return []

  const releases = new Map<
    string,
    SlskdSearchResult & Required<Pick<SlskdSearchResult, 'directory' | 'directories' | 'files'>>
  >()
  const rejectedReleases = new Set<string>()
  let processedFiles = 0
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const response = value as SlskdSearchResponse
    if (typeof response.username !== 'string' || !response.username.trim()) continue
    if (!Array.isArray(response.files)) continue

    for (const rawFile of response.files) {
      processedFiles++
      if (processedFiles > SLSKD_MAX_SEARCH_FILES) break
      const file = asSearchFile(rawFile)
      if (!file) continue
      const directory = releaseDirectory(file.filename)
      if (!directory) continue
      const key = `${response.username}\0${directory}`
      if (rejectedReleases.has(key)) continue
      const existing = releases.get(key)
      if (existing) {
        if (!existing.files.some((candidate) => candidate.filename === file.filename)) {
          if (
            existing.files.length >= SLSKD_MAX_RELEASE_FILES ||
            existing.size + file.size > SLSKD_MAX_RELEASE_BYTES
          ) {
            releases.delete(key)
            rejectedReleases.add(key)
            continue
          }
          existing.files.push(file)
          existing.size += file.size
        }
        const sourceDirectory = remoteDirectory(file.filename)
        if (sourceDirectory && !existing.directories.includes(sourceDirectory)) {
          existing.directories.push(sourceDirectory)
        }
        continue
      }

      const sourceDirectory = remoteDirectory(file.filename)
      if (file.size > SLSKD_MAX_RELEASE_BYTES) {
        rejectedReleases.add(key)
        continue
      }
      releases.set(key, {
        id: releaseId(response.username, directory),
        filename: releaseLabel(directory),
        username: response.username,
        directory,
        directories: sourceDirectory ? [sourceDirectory] : [],
        files: [file],
        size: file.size,
      })
    }
  }

  return [...releases.values()]
}

function validatedManifest(result: SlskdSearchResult): SlskdSearchFile[] {
  const files = result.files ?? [{ filename: result.filename, size: result.size }]
  if (files.length === 0 || files.length > SLSKD_MAX_RELEASE_FILES) {
    throw new Error(`slskd release manifest exceeds ${SLSKD_MAX_RELEASE_FILES} files`)
  }
  let totalBytes = 0
  for (const file of files) {
    if (
      !file.filename.trim() ||
      file.filename.length > SLSKD_MAX_REMOTE_PATH_LENGTH ||
      !Number.isFinite(file.size) ||
      file.size <= 0
    ) {
      throw new Error('slskd release manifest contains an invalid file')
    }
    totalBytes += file.size
    if (totalBytes > SLSKD_MAX_RELEASE_BYTES) {
      throw new Error(`slskd release manifest exceeds ${SLSKD_MAX_RELEASE_BYTES} bytes`)
    }
  }
  return files
}

function parseEnqueueResponse(raw: unknown): SlskdEnqueueResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('slskd batch enqueue returned a malformed response')
  }
  const response = raw as Record<string, unknown>
  if (!response.batch || typeof response.batch !== 'object') {
    throw new Error('slskd batch enqueue response is missing its batch')
  }
  const batchId = (response.batch as Record<string, unknown>).id
  if (typeof batchId !== 'string' || !UUID_PATTERN.test(batchId)) {
    throw new Error('slskd batch enqueue response has a missing or malformed batch id')
  }
  if (!Array.isArray(response.failures)) {
    throw new Error('slskd batch enqueue response has malformed failures')
  }
  const failures = response.failures.map((failure) => {
    if (!failure || typeof failure !== 'object') {
      throw new Error('slskd batch enqueue response has a malformed failure')
    }
    const row = failure as Record<string, unknown>
    if (typeof row.filename !== 'string' || typeof row.message !== 'string') {
      throw new Error('slskd batch enqueue response has a malformed failure')
    }
    return { filename: row.filename, message: row.message }
  })
  return { batch: { id: batchId }, failures }
}

export function createSlskdClient(url: string, apiKey: string, skipTlsVerify = false) {
  const http = createHttpClient({
    baseUrl: url,
    headers: { 'X-API-KEY': apiKey },
    skipTlsVerify,
  })

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const application = await http.get<Record<string, unknown>>('/api/v0/application')
      const version = typeof application.version === 'string' ? application.version : undefined

      return {
        success: true,
        message: version ? `Connected to slskd v${version}` : 'Connected to slskd',
      }
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) }
    }
  }

  function createSearch(queryText: string): Promise<Record<string, unknown>> {
    return http.post('/api/v0/searches', { searchText: queryText })
  }

  async function getSearchResults(searchId: string): Promise<SlskdSearchResult[]> {
    const raw = await http.get<unknown>(`/api/v0/searches/${searchId}/responses`)
    return mapSearchResponses(raw)
  }

  async function enqueueResult(
    searchId: string,
    result: SlskdSearchResult,
  ): Promise<SlskdEnqueueResponse> {
    const files = validatedManifest(result)
    const response = await http.post<unknown>('/api/v0/transfers/downloads/batches', {
      searchId,
      username: result.username,
      files: files.map((file) => ({
        filename: file.filename,
        size: file.size,
      })),
      options: {},
    })
    return parseEnqueueResponse(response)
  }

  function getDownloads(): Promise<SlskdDownloadUser[]> {
    return http.get('/api/v0/transfers/downloads')
  }

  return {
    testConnection,
    createSearch,
    getSearchResults,
    enqueueResult,
    getDownloads,
  }
}
