import PQueue from 'p-queue'
import type { ServiceTestResult } from '@/core/types'
import { errMsg } from '@/core/validation'
import { createHttpClient } from './http'

export type PlexTopArtist = {
  name: string
  viewCount: number
  ratingKey: string
  genres: string[]
}

export type PlexRecentTrack = {
  artistName: string
  trackName: string
  viewedAt: number
  artistRatingKey: string
}

export type PlexIdentity = {
  machineIdentifier: string
  claimed?: boolean
  version?: string
}

export type PlexAccount = {
  id: number
  name: string
}

export type PlexSimilarArtist = {
  guid: string
  name: string
}

export type PlexHistoryItem = PlexRecentTrack & {
  accountId: number
  librarySectionId: string
  ratingKey: string
}

export type PlexHistoryOptions = {
  accountId: number
  librarySectionId: string
  since?: number
  pageSize?: number
  maxItems?: number
  maxPages?: number
  requireComplete?: boolean
}

type PlexSectionsResponse = {
  MediaContainer: {
    Directory: Array<{ key: string; type: string; title: string }>
  }
}

type PlexIdentityResponse = {
  MediaContainer: {
    machineIdentifier?: string
    claimed?: boolean
    version?: string
  }
}

type PlexAccountsResponse = {
  MediaContainer: {
    Account?: Array<{ id: number | string; name?: string; title?: string }>
  }
}

type PlexHistoryResponse = {
  MediaContainer: {
    totalSize?: number
    Metadata?: Array<{
      type: string
      accountID?: number | string
      librarySectionID?: number | string
      grandparentRatingKey?: number | string
      grandparentTitle?: string
      ratingKey?: number | string
      title?: string
      viewedAt?: number
    }>
  }
}

type PlexArtistMetadataResponse = {
  MediaContainer: {
    Metadata?: Array<{
      Similar?: Array<{ guid?: string; tag?: string }>
    }>
  }
}

type PlexAllArtistsResponse = {
  MediaContainer: {
    totalSize?: number
    Metadata?: Array<{
      ratingKey: string
      title: string
      Genre?: Array<{ tag: string }>
    }>
  }
}

export type PlexLibraryArtist = {
  ratingKey: string
  name: string
  genres: string[]
}

export type PlexLibraryAlbum = {
  ratingKey: string
  artistRatingKey: string
  title: string
  releaseYear?: number
  primaryType?: 'Album'
}

export type PlexMusicSection = {
  key: string
  title: string
}

export type PlexClient = {
  getIdentity: () => Promise<PlexIdentity>
  getAccounts: () => Promise<PlexAccount[]>
  getMusicSectionId: () => Promise<string>
  getMusicSections: () => Promise<PlexMusicSection[]>
  getHistory: (options: PlexHistoryOptions) => Promise<PlexHistoryItem[]>
  getTopArtists: (limit?: number, options?: { since?: number }) => Promise<PlexTopArtist[]>
  getTopArtistsPaged: (options: {
    limit: number
    offset: number
    since?: number
  }) => Promise<{ artists: PlexTopArtist[]; totalCount: number }>
  getAllArtists: (options?: { pageSize?: number }) => Promise<PlexLibraryArtist[]>
  getAlbumsForArtist: (artistRatingKey: string) => Promise<PlexLibraryAlbum[]>
  getRecentlyPlayed: (limit?: number) => Promise<PlexRecentTrack[]>
  getSimilarArtists: (artistRatingKey: string) => Promise<PlexSimilarArtist[]>
  testConnection: () => Promise<ServiceTestResult>
}

const DEFAULT_HISTORY_PAGE_SIZE = 200
const MAX_HISTORY_PAGE_SIZE = 500
const MAX_HISTORY_ITEMS = 5_000
const MAX_HISTORY_PAGES = 25

export function createPlexClient(
  url: string,
  token: string,
  options?: {
    baseUrl?: string
    sectionId?: string | null
    accountId?: number | null
    machineIdentifier?: string | null
  },
): PlexClient {
  const baseUrl = options?.baseUrl ?? url.replace(/\/+$/, '')
  const configuredSectionId = options?.sectionId?.trim() || null
  const configuredAccountId = options?.accountId ?? null
  const configuredMachineIdentifier = options?.machineIdentifier?.trim() || null

  const http = createHttpClient({
    baseUrl,
    headers: {
      'X-Plex-Token': token,
      Accept: 'application/json',
    },
  })
  const queue = new PQueue({ concurrency: 3, interval: 1000, intervalCap: 10 })

  function get<T>(path: string): Promise<T> {
    return queue.add(() => http.get<T>(path)) as Promise<T>
  }

  async function getIdentity(): Promise<PlexIdentity> {
    const res = await get<PlexIdentityResponse>('/identity')
    const machineIdentifier = res.MediaContainer.machineIdentifier?.trim()
    if (!machineIdentifier) throw new Error('Plex did not return a machine identifier')
    return {
      machineIdentifier,
      claimed: res.MediaContainer.claimed,
      version: res.MediaContainer.version,
    }
  }

  async function getAccounts(): Promise<PlexAccount[]> {
    const res = await get<PlexAccountsResponse>('/accounts')
    const accounts: PlexAccount[] = []
    for (const raw of res.MediaContainer.Account ?? []) {
      const id = Number(raw.id)
      const name = (raw.name ?? raw.title ?? '').trim()
      if (Number.isSafeInteger(id) && id > 0 && name) accounts.push({ id, name })
    }
    return accounts
  }

  async function getMusicSections(): Promise<PlexMusicSection[]> {
    const res = await get<PlexSectionsResponse>('/library/sections')
    return res.MediaContainer.Directory.filter((directory) => directory.type === 'artist').map(
      (directory) => ({ key: directory.key, title: directory.title }),
    )
  }

  async function getMusicSectionId(): Promise<string> {
    if (configuredSectionId) return configuredSectionId
    const section = (await getMusicSections())[0]
    if (!section) throw new Error('No music library section found in Plex')
    return section.key
  }

  function requireListeningBinding(): {
    accountId: number
    librarySectionId: string
    machineIdentifier: string
  } {
    if (
      !configuredAccountId ||
      !Number.isSafeInteger(configuredAccountId) ||
      configuredAccountId < 1 ||
      !configuredSectionId ||
      !configuredMachineIdentifier
    ) {
      throw new Error(
        'Plex listening history requires a verified account and music library selection',
      )
    }
    return {
      accountId: configuredAccountId,
      librarySectionId: configuredSectionId,
      machineIdentifier: configuredMachineIdentifier,
    }
  }

  let verifiedListeningBinding: Promise<void> | null = null
  async function verifyListeningBinding(): Promise<void> {
    const binding = requireListeningBinding()
    verifiedListeningBinding ??= getIdentity().then((identity) => {
      if (identity.machineIdentifier !== binding.machineIdentifier) {
        throw new Error('Plex server identity changed; select the listening account again')
      }
    })
    return verifiedListeningBinding
  }

  async function getHistory(options: PlexHistoryOptions): Promise<PlexHistoryItem[]> {
    if (!Number.isSafeInteger(options.accountId) || options.accountId < 1) {
      throw new Error('Plex history requires a valid account ID')
    }
    if (!options.librarySectionId.trim()) {
      throw new Error('Plex history requires a music library section')
    }

    const pageSize = Math.min(
      MAX_HISTORY_PAGE_SIZE,
      Math.max(1, Math.trunc(options.pageSize ?? DEFAULT_HISTORY_PAGE_SIZE)),
    )
    const maxItems = Math.min(
      MAX_HISTORY_ITEMS,
      Math.max(1, Math.trunc(options.maxItems ?? MAX_HISTORY_ITEMS)),
    )
    const maxPages = Math.min(
      MAX_HISTORY_PAGES,
      Math.max(1, Math.trunc(options.maxPages ?? MAX_HISTORY_PAGES)),
    )
    const items: PlexHistoryItem[] = []
    let start = 0
    let total = Number.POSITIVE_INFINITY
    let exhausted = false

    for (let page = 0; page < maxPages && start < total && items.length < maxItems; page++) {
      const requestSize = Math.min(pageSize, maxItems - items.length)
      const params = new URLSearchParams({
        accountID: String(options.accountId),
        librarySectionID: options.librarySectionId,
        sort: 'viewedAt:desc',
        'X-Plex-Container-Start': String(start),
        'X-Plex-Container-Size': String(requestSize),
      })
      if (options.since != null) {
        params.set('viewedAt>=', String(Math.max(0, Math.trunc(options.since))))
      }

      const res = await get<PlexHistoryResponse>(`/status/sessions/history/all?${params}`)
      const metadata = res.MediaContainer.Metadata ?? []
      total = res.MediaContainer.totalSize ?? total
      let pageExceededItemLimit = false

      for (const raw of metadata) {
        const returnedAccountId = Number(raw.accountID)
        if (returnedAccountId !== options.accountId) {
          throw new Error(
            `Plex returned history for account ${String(raw.accountID)} while account ${options.accountId} was requested`,
          )
        }
        const returnedSectionId = raw.librarySectionID == null ? null : String(raw.librarySectionID)
        if (returnedSectionId != null && returnedSectionId !== options.librarySectionId) {
          throw new Error(
            `Plex returned history for library section ${returnedSectionId} while section ${options.librarySectionId} was requested`,
          )
        }
        if (raw.type !== 'track') continue

        const artistName = raw.grandparentTitle?.trim()
        const trackName = raw.title?.trim()
        const artistRatingKey = String(raw.grandparentRatingKey ?? '').trim()
        const ratingKey = String(raw.ratingKey ?? '').trim()
        const viewedAt = Number(raw.viewedAt)
        if (options.since != null && Number.isFinite(viewedAt) && viewedAt < options.since) continue
        if (
          !artistName ||
          !trackName ||
          !artistRatingKey ||
          !ratingKey ||
          !Number.isFinite(viewedAt)
        ) {
          continue
        }
        if (items.length >= maxItems) {
          pageExceededItemLimit = true
          continue
        }
        items.push({
          accountId: returnedAccountId,
          librarySectionId: returnedSectionId ?? options.librarySectionId,
          artistName,
          trackName,
          artistRatingKey,
          ratingKey,
          viewedAt: viewedAt * 1000,
        })
      }

      start += metadata.length
      exhausted = pageExceededItemLimit
        ? false
        : Number.isFinite(total)
          ? start >= total
          : metadata.length < requestSize
      if (exhausted || metadata.length === 0) break
    }
    if (options.requireComplete && !exhausted) {
      throw new Error(
        `Plex history exceeds the bounded retrieval limit (${maxItems} items or ${maxPages} pages)`,
      )
    }
    return items
  }

  async function collectTopArtists(since?: number): Promise<PlexTopArtist[]> {
    const binding = requireListeningBinding()
    await verifyListeningBinding()
    const history = await getHistory({
      accountId: binding.accountId,
      librarySectionId: binding.librarySectionId,
      since,
      requireComplete: true,
    })
    const byArtist = new Map<string, PlexTopArtist>()
    for (const item of history) {
      const key = item.artistName.toLocaleLowerCase()
      const existing = byArtist.get(key)
      if (existing) existing.viewCount += 1
      else {
        byArtist.set(key, {
          name: item.artistName,
          viewCount: 1,
          ratingKey: item.artistRatingKey,
          genres: [],
        })
      }
    }
    return [...byArtist.values()].sort(
      (a, b) => b.viewCount - a.viewCount || a.name.localeCompare(b.name),
    )
  }

  async function getTopArtists(limit = 50, options?: { since?: number }): Promise<PlexTopArtist[]> {
    return (await collectTopArtists(options?.since)).slice(0, Math.max(0, Math.trunc(limit)))
  }

  async function getTopArtistsPaged(options: {
    limit: number
    offset: number
    since?: number
  }): Promise<{ artists: PlexTopArtist[]; totalCount: number }> {
    const artists = await collectTopArtists(options.since)
    const offset = Math.max(0, Math.trunc(options.offset))
    const limit = Math.max(0, Math.trunc(options.limit))
    return { artists: artists.slice(offset, offset + limit), totalCount: artists.length }
  }

  async function getRecentlyPlayed(limit = 50): Promise<PlexRecentTrack[]> {
    const binding = requireListeningBinding()
    await verifyListeningBinding()
    const history = await getHistory({
      accountId: binding.accountId,
      librarySectionId: binding.librarySectionId,
      maxItems: Math.max(1, Math.trunc(limit)),
    })
    return history.slice(0, limit).map((item) => ({
      artistName: item.artistName,
      trackName: item.trackName,
      viewedAt: item.viewedAt,
      artistRatingKey: item.artistRatingKey,
    }))
  }

  async function getSimilarArtists(artistRatingKey: string): Promise<PlexSimilarArtist[]> {
    await verifyListeningBinding()
    const res = await get<PlexArtistMetadataResponse>(
      `/library/metadata/${encodeURIComponent(artistRatingKey)}`,
    )
    const similar = res.MediaContainer.Metadata?.[0]?.Similar ?? []
    return similar.flatMap((item) => {
      const guid = item.guid?.trim()
      const name = item.tag?.trim()
      return guid && name ? [{ guid, name }] : []
    })
  }

  async function getAllArtists(options?: { pageSize?: number }): Promise<PlexLibraryArtist[]> {
    const sectionId = await getMusicSectionId()
    const pageSize = options?.pageSize ?? 200
    const all: PlexLibraryArtist[] = []
    let start = 0
    let total = Number.POSITIVE_INFINITY

    while (start < total) {
      const params = new URLSearchParams({
        type: '8',
        sort: 'titleSort',
        'X-Plex-Container-Start': String(start),
        'X-Plex-Container-Size': String(pageSize),
      })
      const res = await get<PlexAllArtistsResponse>(`/library/sections/${sectionId}/all?${params}`)
      const metadata = res.MediaContainer.Metadata ?? []
      total = res.MediaContainer.totalSize ?? metadata.length
      for (const item of metadata) {
        all.push({
          ratingKey: item.ratingKey,
          name: item.title,
          genres: (item.Genre ?? []).map((genre) => genre.tag),
        })
      }
      if (metadata.length === 0) break
      start += metadata.length
    }
    return all
  }

  async function getAlbumsForArtist(artistRatingKey: string): Promise<PlexLibraryAlbum[]> {
    const pageSize = 200
    const all: PlexLibraryAlbum[] = []
    let start = 0
    let total: number | undefined

    while (start < (total ?? Number.POSITIVE_INFINITY)) {
      const params = new URLSearchParams({
        type: '9',
        'X-Plex-Container-Start': String(start),
        'X-Plex-Container-Size': String(pageSize),
      })
      const res = await get<{
        MediaContainer: {
          totalSize?: number
          Metadata?: Array<{
            ratingKey: string
            parentRatingKey: string
            title: string
            year?: number
          }>
        }
      }>(`/library/metadata/${artistRatingKey}/children?${params}`)
      const metadata = res.MediaContainer.Metadata ?? []
      if (res.MediaContainer.totalSize != null) total = res.MediaContainer.totalSize
      for (const item of metadata) {
        all.push({
          ratingKey: item.ratingKey,
          artistRatingKey: item.parentRatingKey,
          title: item.title,
          releaseYear: item.year,
          primaryType: 'Album',
        })
      }
      if (metadata.length === 0) break
      start += metadata.length
      if (total == null && metadata.length < pageSize) break
    }
    return all
  }

  async function testConnection(): Promise<ServiceTestResult> {
    try {
      const [identity, sections] = await Promise.all([getIdentity(), getMusicSections()])
      if (sections.length === 0) {
        return { success: false, message: 'No music library section found in Plex' }
      }
      const selected = configuredSectionId
        ? sections.find((section) => section.key === configuredSectionId)
        : sections[0]
      if (!selected) {
        return {
          success: false,
          message: `Configured Plex library section ${configuredSectionId} not found - available: ${sections
            .map((section) => `${section.title} (${section.key})`)
            .join(', ')}`,
        }
      }
      if (
        configuredMachineIdentifier &&
        configuredMachineIdentifier !== identity.machineIdentifier
      ) {
        return {
          success: false,
          message: 'Configured Plex account belongs to a different server',
        }
      }

      let accounts: PlexAccount[] = []
      try {
        accounts = await getAccounts()
      } catch (error) {
        if (configuredAccountId) throw error
      }
      const selectedAccount = configuredAccountId
        ? accounts.find((account) => account.id === configuredAccountId)
        : undefined
      if (configuredAccountId && !selectedAccount) {
        return {
          success: false,
          message: `Plex account ${configuredAccountId} is not available on this server`,
        }
      }
      const accountMessage = selectedAccount
        ? `; listening as ${selectedAccount.name}`
        : accounts.length === 0
          ? '; account list unavailable, so listening history is disabled'
          : '; select an account to enable listening history'
      return {
        success: true,
        message: `Connected to Plex - using library "${selected.title}" (section ${selected.key})${accountMessage}`,
        details: {
          sectionId: selected.key,
          sections,
          machineIdentifier: identity.machineIdentifier,
          accounts,
          ...(selectedAccount
            ? { accountId: selectedAccount.id, accountName: selectedAccount.name }
            : {}),
        },
      }
    } catch (error: unknown) {
      return { success: false, message: errMsg(error) }
    }
  }

  return {
    getIdentity,
    getAccounts,
    getMusicSectionId,
    getMusicSections,
    getHistory,
    getTopArtists,
    getTopArtistsPaged,
    getAllArtists,
    getAlbumsForArtist,
    getRecentlyPlayed,
    getSimilarArtists,
    testConnection,
  }
}
