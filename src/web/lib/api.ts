import type { GenreInfo } from '../../core/genre/types'

export type LibraryArtist = {
  id: number
  mbid: string
  name: string
  disambiguation: string | null
  genres: string[] | null
  imageUrl: string | null
}

const BASE = '/api'

const AUTH_TOKEN_KEY = 'digarr-auth-token'

export function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function setStoredToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: unknown,
  ) {
    super(`API Error ${status}`)
  }
}

// Fired when any fetchApi call gets 401 -- AuthGate listens and shows login
export const AUTH_EXPIRED_EVENT = 'digarr:auth-expired'

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getStoredToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const { headers: extraHeaders, ...restOptions } = options ?? {}
  const res = await fetch(`${BASE}${path}`, {
    ...restOptions,
    headers: { ...headers, ...(extraHeaders as Record<string, string>) },
  })
  if (!res.ok) {
    if (res.status === 401) {
      clearStoredToken()
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
      throw new ApiError(res.status, { error: 'Session expired' })
    }
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, error)
  }
  return res.json() as Promise<T>
}

// Auth
export type AuthStatus = {
  required: boolean
  hasUsers: boolean
  oidcEnabled?: boolean
  proxyAuthEnabled?: boolean
  proxyAuth?: boolean
  token?: string
  userId?: number
  version?: string
}
export const getAuthStatus = () => fetchApi<AuthStatus>('/auth/status')

export type AuthResponse = {
  user: { id: number; username: string; isAdmin: boolean }
  token: string
}
export const loginUser = (username: string, password: string) =>
  fetchApi<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
export const registerUser = (username: string, password: string) =>
  fetchApi<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
export type UserProfile = { id: number; username: string; isAdmin: boolean }
export async function getCurrentUser(): Promise<UserProfile | null> {
  const token = getStoredToken()
  if (!token) return null
  try {
    const res = await fetch(`${BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null // Legacy token users have no userId -- don't trigger auth-expired
    return res.json() as Promise<UserProfile>
  } catch {
    return null
  }
}
export const changePassword = (currentPassword: string, newPassword: string) =>
  fetchApi<{ ok: boolean; token?: string }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })

export const logoutUser = () => fetchApi<{ ok: boolean }>('/auth/logout', { method: 'POST' })

// Setup
export const getSetupStatus = () => fetchApi<{ setupComplete: boolean }>('/setup/status')
export const completeSetup = (config: Record<string, unknown>) =>
  fetchApi('/setup/complete', { method: 'POST', body: JSON.stringify(config) })

// Settings
export const getSettings = () => fetchApi<Record<string, unknown>>('/settings')
export const updateSettings = (partial: Record<string, unknown>) =>
  fetchApi('/settings', { method: 'PATCH', body: JSON.stringify(partial) })
export const testService = (service: string, config: Record<string, unknown>) =>
  fetchApi<{ success: boolean; message: string }>(`/settings/test/${service}`, {
    method: 'POST',
    body: JSON.stringify(config),
  })
export const testWebhook = () =>
  fetchApi<{ success: boolean; message: string }>('/settings/test-webhook', { method: 'POST' })

// Pipeline
export const triggerPipeline = () => fetchApi('/pipeline/run', { method: 'POST' })
export const getPipelineStatus = () =>
  fetchApi<{ running: boolean; stage?: string; message?: string; lastRun?: unknown }>(
    '/pipeline/status',
  )
export const rescanArtists = () =>
  fetchApi<{ updated: number; total: number }>('/pipeline/rescan', { method: 'POST' })

// Recommendations
export const getRecommendations = (params?: Record<string, string>) => {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : ''
  return fetchApi<{ items: unknown[]; total: number }>(`/recommendations${qs}`)
}
export const updateRecommendation = (id: number, body: Record<string, unknown>) =>
  fetchApi(`/recommendations/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const approveRecommendation = (
  id: number,
  options?: {
    monitorOption?: string
    selectedAlbumIds?: string[]
    qualityProfileId?: number
    metadataProfileId?: number
    rootFolderId?: number
  },
) => updateRecommendation(id, { status: 'approved', ...options })
export const bulkAction = (ids: number[], action: string) =>
  fetchApi('/recommendations/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) })

export const getFeedbackSummary = () =>
  fetchApi<{
    summary: Array<{
      genre: string
      approved: number
      rejected: number
      total: number
      rate: number
    }>
  }>('/recommendations/feedback-summary')

// Albums
export type ReleaseGroup = {
  id: string
  title: string
  type: string
  firstReleaseDate?: string
}
export const getAlbums = (mbid: string) =>
  fetchApi<ReleaseGroup[]>(`/albums/${encodeURIComponent(mbid)}`)

// Batches
export const getBatches = () => fetchApi<unknown[]>('/batches')
export const getBatch = (id: number) => fetchApi<unknown>(`/batches/${id}`)

// Artists
export const getArtist = (id: number) => fetchApi<unknown>(`/artists/${id}`)

// Listening
export const getRecentListens = (range = 'month', limit = 5) => {
  const qs = new URLSearchParams({ range, limit: String(limit) })
  return fetchApi<{
    tracks: Array<{
      artist: string
      track: string
      source: string
      imageUrl?: string
      mbid?: string
    }>
  }>(`/listening/recent?${qs}`)
}

// Quick discover
export const quickDiscover = (artistName: string) =>
  fetchApi<{ message: string }>('/pipeline/quick-discover', {
    method: 'POST',
    body: JSON.stringify({ artistName }),
  })

// Analytics
export type AnalyticsOverview = {
  totalRecs: number
  approvalRate: number
  avgScore: number
  totalBatches: number
}
export type AnalyticsBatch = {
  id: number
  createdAt: string
  status: string
  stats: unknown
  total: number
  approved: number
  rejected: number
  pending: number
}
export type AnalyticsGenre = {
  genre: string
  count: number
  approved: number
  approvalRate: number
}
export type AnalyticsSource = {
  source: string
  count: number
  avgScore: number
  approved: number
  approvalRate: number
}
export const getAnalyticsOverview = () => fetchApi<AnalyticsOverview>('/analytics/overview')
export const getAnalyticsBatches = () => fetchApi<AnalyticsBatch[]>('/analytics/batches')
export const getAnalyticsGenres = () => fetchApi<AnalyticsGenre[]>('/analytics/genres')
export const getAnalyticsSources = () => fetchApi<AnalyticsSource[]>('/analytics/sources')
export type ScoreBucket = { bucket: string; count: number }
export type ApprovalTrend = { batchId: number; createdAt: string; approvalRate: number }
export type TimeToAct = { status: string; avgDays: number; count: number }
export const getScoreDistribution = () => fetchApi<ScoreBucket[]>('/analytics/scores')
export const getApprovalTrend = () => fetchApi<ApprovalTrend[]>('/analytics/trend')
export const getTimeToAct = () => fetchApi<TimeToAct[]>('/analytics/time-to-act')

// Lidarr
export const getLidarrStats = () =>
  fetchApi<{ artists: number; monitored: number }>('/lidarr/stats')
export const getLidarrProfiles = () =>
  fetchApi<Array<{ id: number; name: string }>>('/lidarr/profiles')
export const getLidarrMetadataProfiles = () =>
  fetchApi<Array<{ id: number; name: string }>>('/lidarr/metadataprofiles')
export const getLidarrRootFolders = () =>
  fetchApi<Array<{ id: number; path: string; freeSpace?: number }>>('/lidarr/rootfolders')
export const addToLidarr = (body: Record<string, unknown>) =>
  fetchApi('/lidarr/add', { method: 'POST', body: JSON.stringify(body) })

// Library Health
export type HealthCheckItem = {
  artistId: number
  artistName: string
  mbid: string
  detail: string
}
export type HealthCheckResult = {
  id: string
  name: string
  description: string
  severity: 'info' | 'warning' | 'error'
  count: number
  items: HealthCheckItem[]
  fixable: boolean
}
export type HealthCheckResponse = {
  checks: HealthCheckResult[]
  scanning: boolean
}
export type LibraryStats = {
  totalArtists: number
  totalAlbums: number
  monitoredArtists: number
  genreDistribution: Array<{ genre: string; count: number }>
  rootFolders: Array<{ path: string; freeSpace: number }>
}
export const getLibraryHealth = () => fetchApi<HealthCheckResponse>('/library/health')
export const scanLibraryHealth = () =>
  fetchApi<{ scanning: boolean }>('/library/health/scan', { method: 'POST' })
export type HealthFixResult = {
  checkId: string
  total: number
  completed: number
  failed: number
  status: 'completed' | 'failed'
  errors: string[]
}
export const fixHealthCheck = (checkId: string) =>
  fetchApi<HealthFixResult>(`/library/health/${encodeURIComponent(checkId)}/fix`, {
    method: 'POST',
  })
export const getLibraryStats = () => fetchApi<LibraryStats>('/library/stats')

// Genres
export const getGenres = () => fetchApi<GenreInfo[]>('/genres')
export const searchGenres = (q: string) =>
  fetchApi<GenreInfo[]>(`/genres/search?q=${encodeURIComponent(q)}`)
export const getGenre = (slug: string) =>
  fetchApi<GenreInfo & { subGenres: GenreInfo[]; libraryArtists: LibraryArtist[] }>(
    `/genres/${encodeURIComponent(slug)}`,
  )
export const seedGenres = () => fetchApi<{ message: string }>('/genres/seed', { method: 'POST' })

export type GenreArtist = {
  name: string
  mbid: string
  imageUrl: string | null
  score: number
  genres: string[] | null
  aiReasoning: string | null
  streamingUrls: Record<string, string> | null
}

export const getGenreArtists = (slug: string, view: string, limit = 20) =>
  fetchApi<{ artists: GenreArtist[] }>(
    `/genres/${encodeURIComponent(slug)}/artists?view=${encodeURIComponent(view)}&limit=${limit}`,
  )

// Library warm status
export const getWarmStatuses = (mbids: string) =>
  fetchApi<{ statuses: Record<string, string> }>(`/library/warm/status?mbids=${mbids}`)
export const warmArtists = (mbids: string[]) =>
  fetchApi('/library/warm', {
    method: 'POST',
    body: JSON.stringify({ mbids }),
  })

// User management (admin)
export const listUsers = () =>
  fetchApi<
    Array<{
      id: number
      username: string
      isAdmin: boolean
      email: string | null
      oidcSubject: string | null
      authProvider: string
      createdAt: string
    }>
  >('/users')
export const createUserApi = (data: { username: string; password: string; isAdmin?: boolean }) =>
  fetchApi<{ id: number; username: string; isAdmin: boolean }>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  })
export const updateUserAdmin = (id: number, isAdmin: boolean) =>
  fetchApi(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ isAdmin }) })
export const deleteUserApi = (id: number) => fetchApi(`/users/${id}`, { method: 'DELETE' })

// Targets
export type TargetInfo = {
  id: number
  type: string
  name: string
  config: Record<string, unknown>
  enabled: boolean
  owned: boolean
}
export const listTargets = () => fetchApi<TargetInfo[]>('/targets')
export const createTargetApi = (data: {
  type: string
  name: string
  config: Record<string, unknown>
}) => fetchApi<{ id: number }>('/targets', { method: 'POST', body: JSON.stringify(data) })
export const deleteTargetApi = (id: number) => fetchApi(`/targets/${id}`, { method: 'DELETE' })
export const testTargetApi = (id: number) =>
  fetchApi<{ success: boolean; message: string }>(`/targets/${id}/test`, { method: 'POST' })

// Target-aware approve
export async function approveToTarget(
  recId: number,
  targetId: string,
  options?: {
    monitorOption?: string
    selectedAlbumIds?: string[]
    qualityProfileId?: number
    metadataProfileId?: number
    rootFolderId?: number
  },
): Promise<{ status: string; targetActions?: Record<string, unknown> }> {
  return fetchApi(`/recommendations/${recId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'approved',
      targetId,
      ...options,
    }),
  })
}

export async function exportRecommendations(
  format: 'json' | 'csv' | 'm3u' | 'xspf',
  params?: { status?: string; batchId?: number },
) {
  const query = new URLSearchParams()
  if (params?.status) query.set('status', params.status)
  if (params?.batchId) query.set('batchId', String(params.batchId))
  const qs = query.toString() ? `?${query}` : ''
  const token = getStoredToken()
  const response = await fetch(`${BASE}/exports/${format}${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new Error('Export failed')
  await downloadResponseBlob(
    response,
    `digarr-export-${new Date().toISOString().slice(0, 10)}.${format}`,
  )
}

async function downloadResponseBlob(response: Response, fallbackFilename: string): Promise<void> {
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = getDownloadFilename(response.headers.get('content-disposition'), fallbackFilename)
  a.click()
  URL.revokeObjectURL(url)
}

function getDownloadFilename(contentDisposition: string | null, fallbackFilename: string): string {
  const match = /filename="([^"]+)"/.exec(contentDisposition ?? '')
  return match?.[1] ?? fallbackFilename
}

// Search
export type SearchResult = {
  name: string
  mbid?: string
  images: { url: string; source: string }[]
  genres: string[]
  popularity?: number
  listeners?: number
  sources: { id: string; url?: string; externalId?: string }[]
  inLibrary: boolean
  inRecommendations: boolean
}

export type SearchSourceOption = {
  id: string
  label: string
  available: boolean
  reason?: string
}

export const getSearchSources = () => fetchApi<{ sources: SearchSourceOption[] }>('/search/sources')

export async function searchArtists(
  query: string,
  sources?: string[],
  limit?: number,
): Promise<{ results: SearchResult[] }> {
  const params = new URLSearchParams({ q: query })
  if (sources?.length) params.set('sources', sources.join(','))
  if (limit) params.set('limit', String(limit))
  return fetchApi(`/search?${params}`)
}

// Mood discovery
export const moodDiscover = (query: string) =>
  fetchApi<{
    results: Array<{
      artistName: string
      reasoning: string
      confidence: number
      genres: string[]
      suggestedAlbum?: string
      inLibrary?: boolean
    }>
  }>('/mood/discover', { method: 'POST', body: JSON.stringify({ query }) })

// OAuth
export async function initiateOAuth(
  provider: string,
  data: { clientId: string; clientSecret: string; redirectUri: string },
): Promise<{ authUrl: string }> {
  return fetchApi(`/auth/oauth/${provider}/initiate`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// User preferences (per-user scoring weights, thresholds, etc.)
export const getUserPreferences = () => fetchApi<Record<string, unknown>>('/auth/me/preferences')
export const updateUserPreferences = (prefs: Record<string, unknown>) =>
  fetchApi('/auth/me/preferences', { method: 'PATCH', body: JSON.stringify(prefs) })

export async function disconnectOAuth(provider: string): Promise<void> {
  await fetchApi(`/auth/oauth/${provider}`, { method: 'DELETE' })
}

export async function getOAuthStatus(
  provider: string,
): Promise<{ connected: boolean; scopes: string | null }> {
  return fetchApi(`/auth/oauth/${provider}/status`)
}

// Subscriptions
export type Subscription = {
  id: number
  name: string
  userId: number | null
  enabled: boolean
  sourceType: string
  sourceProvider: string
  sourceConfig: Record<string, unknown>
  maxArtistsPerRun: number
  listenerRange: { min?: number; max?: number } | null
  cron: string
  action: string
  scoreThreshold: number | null
  scoringWeightPreset: string | null
  scoringWeightOverrides: Record<string, number> | null
  lastRunAt: string | null
  lastResultCount: number | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type SubscriptionRun = {
  id: number
  subscriptionId: number
  startedAt: string
  completedAt: string | null
  artistsFound: number
  artistsNew: number
  error: string | null
  batchId: number | null
}

export type SchedulerJob = {
  name: string
  expression: string
  nextRun: string | null
}

export const getSubscriptions = () => fetchApi<Subscription[]>('/subscriptions')

export const createSubscriptionApi = (data: {
  name: string
  sourceType: string
  sourceProvider: string
  sourceConfig: Record<string, unknown>
  cron: string
  enabled?: boolean
  maxArtistsPerRun?: number
  listenerRange?: { min?: number; max?: number } | null
  action?: string
  scoreThreshold?: number | null
  scoringWeightPreset?: string | null
  scoringWeightOverrides?: Record<string, number> | null
}) =>
  fetchApi<Subscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updateSubscriptionApi = (id: number, data: Partial<Subscription>) =>
  fetchApi<{ updated: boolean }>(`/subscriptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })

export const deleteSubscriptionApi = (id: number) =>
  fetchApi<{ deleted: boolean }>(`/subscriptions/${id}`, { method: 'DELETE' })

export const triggerSubscriptionRun = (id: number) =>
  fetchApi<{ message: string }>(`/subscriptions/${id}/run`, { method: 'POST' })

export const getSubscriptionRuns = (id: number) =>
  fetchApi<SubscriptionRun[]>(`/subscriptions/${id}/runs`)

export const bulkToggleSubscriptions = (enabled: boolean) =>
  fetchApi<{ updated: number }>('/subscriptions/bulk-toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })

export const getSchedulerInfo = () => fetchApi<{ jobs: SchedulerJob[] }>('/subscriptions/scheduler')

// Dashboard
export type TasteGenre = {
  genre: string
  count: number
  percentage: number
}

export type ActivityEntry = {
  type: 'approved' | 'rejected' | 'subscription_run' | 'scan_completed'
  timestamp: string
  data: {
    artistName?: string
    subscriptionName?: string
    artistsFound?: number
    artistsNew?: number
    discovered?: number
    added?: number
    username?: string
  }
}

export const getDashboardTaste = () => fetchApi<TasteGenre[]>('/dashboard/taste')

export const getDashboardActivity = (limit = 5) =>
  fetchApi<ActivityEntry[]>(`/dashboard/activity?limit=${limit}`)

// Playlists
export type PlaylistConfig = {
  size: number
  genre?: string
  mood?: string
  trackSourcePriority: ('local' | 'spotify' | 'deezer')[]
}

export type PlaylistRow = {
  id: number
  userId: number | null
  name: string
  strategy: string
  targetIds: number[]
  schedule: string | null
  config: PlaylistConfig | null
  lastGeneratedAt: string | null
  trackCount: number | null
  enabled: boolean
  createdAt: string
}

export type PlaylistTrackRow = {
  id: number
  playlistId: number
  artistName: string
  trackName: string | null
  mbid: string | null
  spotifyUri: string | null
  deezerId: string | null
  localPath: string | null
  position: number
}

export type PlaylistInsert = {
  name: string
  strategy: string
  targetIds?: number[]
  schedule?: string | null
  config?: PlaylistConfig | null
  enabled?: boolean
}

export const getPlaylists = () => fetchApi<PlaylistRow[]>('/playlists')

export const getPlaylist = (id: number) =>
  fetchApi<{ playlist: PlaylistRow; tracks: PlaylistTrackRow[] }>(`/playlists/${id}`)

export const createPlaylistApi = (data: PlaylistInsert) =>
  fetchApi<{ id: number }>('/playlists', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updatePlaylistApi = (id: number, data: Partial<PlaylistInsert>) =>
  fetchApi<{ updated: boolean }>(`/playlists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })

export const deletePlaylistApi = (id: number) =>
  fetchApi<{ deleted: boolean }>(`/playlists/${id}`, { method: 'DELETE' })

export const generatePlaylistApi = (id: number) =>
  fetchApi<{ status: string }>(`/playlists/${id}/generate`, { method: 'POST' })

export async function exportPlaylistApi(
  id: number,
  format: 'json' | 'csv' | 'm3u' | 'xspf',
): Promise<void> {
  const token = getStoredToken()
  const response = await fetch(`${BASE}/playlists/${id}/export/${format}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new Error('Playlist export failed')
  await downloadResponseBlob(response, `playlist-${id}.${format}`)
}

export const getPlaylistScheduler = () =>
  fetchApi<{ nextRun: string | null; cron: string | null; enabled: boolean }>(
    '/playlists/scheduler',
  )
