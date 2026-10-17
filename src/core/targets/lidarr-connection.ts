// A Lidarr target either references the server Lidarr connection in settings
// (`useServerConnection: true`, nothing else stored) or is a separate instance
// with its own url/apiKey and per-target default IDs. Reference targets are
// resolved at use time so a Connections change reaches approvals immediately.

export type LidarrServerSettings = {
  lidarrUrl?: string | null
  lidarrApiKey?: string | null
  skipTlsVerify?: boolean | null
}

export type LidarrConnection = { url: string; apiKey: string; skipTlsVerify: boolean }

export type LidarrDefaults = {
  qualityProfileId?: number
  metadataProfileId?: number
  rootFolderId?: number
}

const CONNECTION_KEYS = ['url', 'apiKey', 'skipTlsVerify'] as const
const DEFAULT_KEYS = ['qualityProfileId', 'metadataProfileId', 'rootFolderId'] as const

export function usesServerConnection(config: Record<string, unknown> | null | undefined): boolean {
  return config?.useServerConnection === true
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined
}

export function serverLidarrConnection(
  settings: LidarrServerSettings | null | undefined,
): LidarrConnection | null {
  if (!settings?.lidarrUrl || !settings.lidarrApiKey) return null
  return {
    url: settings.lidarrUrl,
    apiKey: settings.lidarrApiKey,
    skipTlsVerify: settings.skipTlsVerify ?? false,
  }
}

export function resolveLidarrTargetConnection(
  config: Record<string, unknown>,
  settings: LidarrServerSettings | null | undefined,
): LidarrConnection | null {
  if (usesServerConnection(config)) return serverLidarrConnection(settings)
  if (typeof config.url !== 'string' || !config.url || typeof config.apiKey !== 'string') {
    return null
  }
  return { url: config.url, apiKey: config.apiKey, skipTlsVerify: config.skipTlsVerify === true }
}

// Separate instances only ever use their own stored IDs; the server-connection
// defaults (user/global preferences) belong to a different Lidarr and must
// never be applied to them. Unset IDs fall back to the instance's first
// profile/root folder at add time.
export function resolveLidarrTargetDefaults(
  config: Record<string, unknown>,
  serverDefaults: { qualityProfileId?: number; metadataProfileId?: number; rootFolderId?: number },
): LidarrDefaults {
  const source = usesServerConnection(config) ? serverDefaults : config
  return {
    qualityProfileId: positiveInt(source.qualityProfileId),
    metadataProfileId: positiveInt(source.metadataProfileId),
    rootFolderId: positiveInt(source.rootFolderId),
  }
}

// Canonical stored shape. A reference keeps only the flag; a separate instance
// drops the flag and keeps connection fields plus valid default IDs.
export function normalizeLidarrTargetConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (usesServerConnection(config)) return { useServerConnection: true }
  const normalized: Record<string, unknown> = { ...config }
  delete normalized.useServerConnection
  for (const key of DEFAULT_KEYS) {
    if (!(key in normalized)) continue
    const id = positiveInt(normalized[key])
    if (id === undefined) delete normalized[key]
    else normalized[key] = id
  }
  return normalized
}

// Default IDs belong to the instance they were picked from. When a separate
// target's url or apiKey changes, drop them so the next add falls back to the
// new instance's first profile/folder until new ones are picked.
export function clearDefaultsOnInstanceChange(
  stored: Record<string, unknown>,
  merged: Record<string, unknown>,
): Record<string, unknown> {
  if (usesServerConnection(merged) || usesServerConnection(stored)) return merged
  const storedUrl = typeof stored.url === 'string' ? stored.url : ''
  const mergedUrl = typeof merged.url === 'string' ? merged.url : ''
  const urlChanged = storedUrl.trim() !== mergedUrl.trim()
  if (!urlChanged && stored.apiKey === merged.apiKey) return merged
  const cleared = { ...merged }
  for (const key of DEFAULT_KEYS) delete cleared[key]
  return cleared
}

// Concrete config for code that reads url/apiKey off a target row (slskd
// imports, connection tests). Reference rows get the current server values.
export function withResolvedLidarrConnection<T extends { type: string; config: unknown }>(
  row: T,
  settings: LidarrServerSettings | null | undefined,
): T {
  const config = (row.config ?? {}) as Record<string, unknown>
  if (row.type !== 'lidarr' || !usesServerConnection(config)) return row
  const connection = serverLidarrConnection(settings)
  const resolved: Record<string, unknown> = { ...config }
  for (const key of CONNECTION_KEYS) delete resolved[key]
  if (connection) Object.assign(resolved, connection)
  return { ...row, config: resolved }
}

// Scheme and host are case-insensitive and URL parsing drops default ports;
// path and query stay exact because Lidarr behind a reverse proxy can live at
// case-sensitive paths.
function connectionKey(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`
  } catch {
    return null
  }
}

function sameInstanceUrl(a: string, b: string): boolean {
  const left = connectionKey(a)
  return left !== null && left === connectionKey(b)
}

export function matchesServerConnection(
  config: Record<string, unknown>,
  settings: LidarrServerSettings | null | undefined,
): boolean {
  const server = serverLidarrConnection(settings)
  if (!server || typeof config.url !== 'string' || typeof config.apiKey !== 'string') return false
  return sameInstanceUrl(config.url, server.url) && config.apiKey === server.apiKey
}

type LidarrTargetStore = {
  listLidarrTargets: () => Promise<Array<{ id: number; config: Record<string, unknown> }>>
  updateTargetConfig: (id: number, config: Record<string, unknown>) => Promise<void>
}

// Startup data migration (#994). Idempotent: rows already referencing the
// server are skipped, and only exact url+apiKey copies of the server
// connection are converted. Everything else stays a separate instance with
// no default IDs, so the Targets UI asks for them.
export async function linkLidarrTargetsToServerConnection(
  settings: LidarrServerSettings | null | undefined,
  store: LidarrTargetStore,
): Promise<number[]> {
  if (!serverLidarrConnection(settings)) return []
  const linked: number[] = []
  for (const row of await store.listLidarrTargets()) {
    if (usesServerConnection(row.config) || !matchesServerConnection(row.config, settings)) continue
    await store.updateTargetConfig(row.id, { useServerConnection: true })
    linked.push(row.id)
  }
  return linked
}
