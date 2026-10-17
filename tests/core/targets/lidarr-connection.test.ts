// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  clearDefaultsOnInstanceChange,
  linkLidarrTargetsToServerConnection,
  normalizeLidarrTargetConfig,
  resolveLidarrTargetConnection,
  resolveLidarrTargetDefaults,
  withResolvedLidarrConnection,
} from '@/core/targets/lidarr-connection'

const server = { lidarrUrl: 'http://lidarr:8686', lidarrApiKey: 'server-key', skipTlsVerify: true }
const proxied = { lidarrUrl: 'http://lidarr/music', lidarrApiKey: 'server-key' }

describe('resolveLidarrTargetConnection', () => {
  it('reads a reference target from the current server settings', () => {
    const config = { useServerConnection: true }
    expect(resolveLidarrTargetConnection(config, server)).toEqual({
      url: 'http://lidarr:8686',
      apiKey: 'server-key',
      skipTlsVerify: true,
    })
    const moved = { ...server, lidarrUrl: 'http://new-lidarr:8686', lidarrApiKey: 'new-key' }
    expect(resolveLidarrTargetConnection(config, moved)).toMatchObject({
      url: 'http://new-lidarr:8686',
      apiKey: 'new-key',
    })
    expect(resolveLidarrTargetConnection(config, { lidarrUrl: null })).toBeNull()
  })

  it('keeps a separate instance on its own url and key', () => {
    const config = { url: 'http://other:8686', apiKey: 'other-key' }
    expect(resolveLidarrTargetConnection(config, server)).toEqual({
      url: 'http://other:8686',
      apiKey: 'other-key',
      skipTlsVerify: false,
    })
  })
})

describe('resolveLidarrTargetDefaults', () => {
  const serverDefaults = { qualityProfileId: 2, metadataProfileId: 3, rootFolderId: 4 }

  it('uses server defaults only for reference targets', () => {
    expect(resolveLidarrTargetDefaults({ useServerConnection: true }, serverDefaults)).toEqual(
      serverDefaults,
    )
    expect(
      resolveLidarrTargetDefaults({ url: 'http://other', apiKey: 'k' }, serverDefaults),
    ).toEqual({
      qualityProfileId: undefined,
      metadataProfileId: undefined,
      rootFolderId: undefined,
    })
    expect(
      resolveLidarrTargetDefaults(
        { url: 'http://other', apiKey: 'k', qualityProfileId: 7, rootFolderId: 9 },
        serverDefaults,
      ),
    ).toEqual({ qualityProfileId: 7, metadataProfileId: undefined, rootFolderId: 9 })
  })
})

describe('normalizeLidarrTargetConfig', () => {
  it('drops stored connection fields from a reference and the flag from a separate instance', () => {
    expect(
      normalizeLidarrTargetConfig({ useServerConnection: true, url: 'http://x', apiKey: 'k' }),
    ).toEqual({ useServerConnection: true })
    expect(
      normalizeLidarrTargetConfig({
        useServerConnection: false,
        url: 'http://x',
        apiKey: 'k',
        qualityProfileId: '5',
        rootFolderId: null,
      }),
    ).toEqual({ url: 'http://x', apiKey: 'k', qualityProfileId: 5 })
  })
})

describe('withResolvedLidarrConnection', () => {
  it('fills reference rows with the server connection and leaves other rows alone', () => {
    const ref = { id: 1, type: 'lidarr', config: { useServerConnection: true } }
    expect(withResolvedLidarrConnection(ref, server).config).toMatchObject({
      url: 'http://lidarr:8686',
      apiKey: 'server-key',
    })
    const slskd = { id: 2, type: 'slskd', config: { useServerConnection: true } }
    expect(withResolvedLidarrConnection(slskd, server)).toBe(slskd)
  })
})

describe('linkLidarrTargetsToServerConnection', () => {
  it('links exact copies once and leaves other instances separate', async () => {
    const rows = new Map<number, Record<string, unknown>>([
      [1, { url: 'http://lidarr:8686/', apiKey: 'server-key', skipTlsVerify: false, tags: [5] }],
      [2, { url: 'http://other:8686', apiKey: 'other-key' }],
      [3, { url: 'http://lidarr:8686', apiKey: 'different-key' }],
      [4, { url: 'HTTP://Lidarr:80/', apiKey: 'server-key' }],
      [5, { url: 'http://lidarr/Music', apiKey: 'server-key' }],
    ])
    const store = {
      listLidarrTargets: vi.fn(async () => [...rows].map(([id, config]) => ({ id, config }))),
      updateTargetConfig: vi.fn(async (id: number, config: Record<string, unknown>) => {
        rows.set(id, config)
      }),
    }

    expect(await linkLidarrTargetsToServerConnection(server, store)).toEqual([1])
    expect(rows.get(1)).toEqual({ useServerConnection: true, tags: [5] })
    expect(rows.get(4)).toMatchObject({ url: 'HTTP://Lidarr:80/' })
    expect(rows.get(2)).toEqual({ url: 'http://other:8686', apiKey: 'other-key' })
    expect(rows.get(3)).toMatchObject({ apiKey: 'different-key' })

    expect(await linkLidarrTargetsToServerConnection(server, store)).toEqual([])
    expect(store.updateTargetConfig).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a server connection', async () => {
    const store = { listLidarrTargets: vi.fn(), updateTargetConfig: vi.fn() }
    expect(await linkLidarrTargetsToServerConnection({ lidarrUrl: '' }, store)).toEqual([])
    expect(store.listLidarrTargets).not.toHaveBeenCalled()
  })
})

describe('linkLidarrTargetsToServerConnection URL matching', () => {
  it('matches scheme, host and default port case-insensitively but keeps path case exact', async () => {
    const rows = new Map<number, Record<string, unknown>>([
      [1, { url: 'HTTP://Lidarr:80/music/', apiKey: 'server-key' }],
      [2, { url: 'http://lidarr/Music', apiKey: 'server-key' }],
    ])
    const store = {
      listLidarrTargets: vi.fn(async () => [...rows].map(([id, config]) => ({ id, config }))),
      updateTargetConfig: vi.fn(async (id: number, config: Record<string, unknown>) => {
        rows.set(id, config)
      }),
    }
    expect(await linkLidarrTargetsToServerConnection(proxied, store)).toEqual([1])
    expect(rows.get(2)).toEqual({ url: 'http://lidarr/Music', apiKey: 'server-key' })
  })
})

describe('clearDefaultsOnInstanceChange', () => {
  const stored = {
    url: 'http://a:8686',
    apiKey: 'k',
    qualityProfileId: 2,
    rootFolderId: 3,
    tags: [5],
  }

  it('drops default IDs when the url or key changes and keeps them otherwise', () => {
    expect(clearDefaultsOnInstanceChange(stored, { ...stored, url: 'http://b:8686' })).toEqual({
      url: 'http://b:8686',
      apiKey: 'k',
    })
    expect(clearDefaultsOnInstanceChange(stored, { ...stored, apiKey: 'new' })).toEqual({
      url: 'http://a:8686',
      apiKey: 'new',
    })
    expect(clearDefaultsOnInstanceChange(stored, { ...stored, rootFolderId: 4 })).toEqual({
      ...stored,
      rootFolderId: 4,
    })
  })
})

it('clears tags when a target changes connection mode', () => {
  expect(
    clearDefaultsOnInstanceChange(
      { useServerConnection: true, tags: [5] },
      { useServerConnection: false, tags: [5], url: 'http://other' },
    ),
  ).not.toHaveProperty('tags')
})
