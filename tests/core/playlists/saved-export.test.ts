import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSavedPlaylistExportStore, pushSavedPlaylistToTargets } from '@/core/playlists/export'
import { PlaylistBusyError, withPlaylistLock } from '@/core/playlists/generation-lock'
import type { DestinationTarget, PlaylistExportSession } from '@/core/targets/types'
import type { Database } from '@/db'
import { getPlaylistExport, resetPlaylistExport } from '@/db/queries/playlist-exports'
import { playlists, targets, users } from '@/db/schema'
import { makeTestDb } from '../../helpers/test-db'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
let fixture: Awaited<ReturnType<typeof makeTestDb>>
let db: Database
const items = [{ artistName: 'Artist', artistMbid: '', trackName: 'Track' }]

beforeAll(async () => {
  fixture = await makeTestDb()
  db = fixture.db as unknown as Database
})
afterAll(async () => fixture.close())
beforeEach(async () => {
  await db.execute(sql`TRUNCATE users CASCADE`)
  await db.insert(users).values({ id: 1, username: 'owner', passwordHash: 'hash' })
  await db.insert(playlists).values({ id: 1, userId: 1, name: 'Mix', strategy: 'weekly_digest' })
  await db
    .insert(targets)
    .values([1, 2].map((id) => ({ id, userId: 1, name: 'Target', type: 'spotify-playlist' })))
})

function destination(targetId = 1, overrides: Partial<PlaylistExportSession> = {}) {
  const session: PlaylistExportSession = {
    scope: 'v1:account',
    createPlaylist: vi.fn(async (_name, onCreated) => {
      await onCreated(`remote-${targetId}`)
      return {
        success: true,
        targetType: 'spotify-playlist',
        targetId,
        playlistId: `remote-${targetId}`,
        itemsAdded: 1,
      }
    }),
    replacePlaylist: vi.fn(async (playlistId) => ({
      success: true,
      targetType: 'spotify-playlist',
      targetId,
      playlistId,
      itemsAdded: 1,
    })),
    ...overrides,
  }
  const target: DestinationTarget = {
    id: `spotify-playlist-${targetId}`,
    name: 'Target',
    type: 'spotify-playlist',
    capabilities: ['createPlaylist'],
    openPlaylistExportSession: vi.fn(async () => session),
    testConnection: vi.fn(),
  }
  return { entry: { targetId, target }, session }
}

const store = () => createSavedPlaylistExportStore(db, 1, 1)

describe('saved playlist exports', () => {
  it('checkpoints creation before population and reuses the binding with fresh adapters and stores', async () => {
    const first = destination(1, {
      createPlaylist: vi.fn(async (_name, onCreated) => {
        await onCreated('remote-1')
        expect(await getPlaylistExport(db, 1, 1, 1)).toMatchObject({
          state: 'linked',
          remotePlaylistId: 'remote-1',
        })
        return {
          success: true,
          targetType: 'spotify-playlist',
          targetId: 1,
          playlistId: 'remote-1',
        }
      }),
    })
    await pushSavedPlaylistToTargets([first.entry], 'Mix', items, store())
    const restarted = destination()
    await pushSavedPlaylistToTargets([restarted.entry], 'Renamed', items, store())
    expect(first.session.createPlaylist).toHaveBeenCalledOnce()
    expect(restarted.session.createPlaylist).not.toHaveBeenCalled()
    expect(restarted.session.replacePlaylist).toHaveBeenCalledWith('remote-1', 'Renamed')
    expect(await getPlaylistExport(db, 1, 1, 1)).toMatchObject({
      state: 'linked',
      remotePlaylistId: 'remote-1',
    })
  })

  it('retains checkpointed IDs after partial failures, attempts other targets, and retries the same ID', async () => {
    const first = destination(1, {
      createPlaylist: vi.fn(async (_name, onCreated) => {
        await onCreated('remote-1')
        return {
          success: false,
          targetType: 'spotify-playlist',
          targetId: 1,
          playlistId: 'remote-1',
          error: 'Population failed',
        }
      }),
    })
    const second = destination(2)
    await expect(
      pushSavedPlaylistToTargets([first.entry, second.entry], 'Mix', items, store()),
    ).rejects.toThrow('Population failed')
    expect(second.session.createPlaylist).toHaveBeenCalledOnce()
    for (const targetId of [1, 2])
      expect(await getPlaylistExport(db, 1, 1, targetId)).toMatchObject({
        state: 'linked',
        remotePlaylistId: `remote-${targetId}`,
      })
    const retry = destination()
    await pushSavedPlaylistToTargets([retry.entry], 'Mix', items, store())
    expect(retry.session.createPlaylist).not.toHaveBeenCalled()
    expect(retry.session.replacePlaylist).toHaveBeenCalledWith('remote-1', 'Mix')
  })

  it.each(['ambiguous response', 'checkpoint failure'] as const)(
    'blocks new creation after %s until explicit local reset',
    async (failure) => {
      const failing = destination(1, {
        createPlaylist: vi.fn(async (_name, onCreated) => {
          if (failure === 'checkpoint failure') await onCreated('remote-1')
          throw new Error(failure)
        }),
      })
      const savedStore = store()
      if (failure === 'checkpoint failure')
        savedStore.link = vi.fn().mockRejectedValue(new Error('checkpoint failure'))
      await expect(
        pushSavedPlaylistToTargets([failing.entry], 'Mix', items, savedStore),
      ).rejects.toThrow(failure)
      expect(await getPlaylistExport(db, 1, 1, 1)).toMatchObject({
        state: 'recovery_required',
        remotePlaylistId: null,
      })
      const retry = destination()
      await expect(
        pushSavedPlaylistToTargets([retry.entry], 'Mix', items, store()),
      ).rejects.toThrow('unresolved')
      expect(retry.session.createPlaylist).not.toHaveBeenCalled()
      expect(retry.session.replacePlaylist).not.toHaveBeenCalled()
      await resetPlaylistExport(db, 1, 1, 1)
      await pushSavedPlaylistToTargets([retry.entry], 'Mix', items, store())
      expect(retry.session.createPlaylist).toHaveBeenCalledOnce()
    },
  )

  it.each([
    'scope changed',
    'missing remote',
    'partial export',
    'no tracks',
    'lookup failed',
  ] as const)('preserves bindings without another create when %s', async (failure) => {
    await pushSavedPlaylistToTargets([destination().entry], 'Mix', items, store())
    const next = destination(1, {
      ...(failure === 'scope changed' ? { scope: 'v1:other-account' } : {}),
      ...(failure === 'missing remote'
        ? { replacePlaylist: vi.fn().mockRejectedValue(new Error('404')) }
        : {}),
      ...(failure === 'partial export'
        ? {
            replacePlaylist: vi.fn().mockResolvedValue({
              success: true,
              targetType: 'spotify-playlist',
              targetId: 1,
              playlistId: 'remote-1',
              itemsAdded: 1,
              itemsSkipped: 1,
            }),
          }
        : {}),
    })
    if (failure === 'lookup failed') {
      const open = next.entry.target.openPlaylistExportSession
      if (!open) throw new Error('Missing test session')
      vi.mocked(open).mockRejectedValue(new Error('lookup failed'))
    }
    await expect(
      pushSavedPlaylistToTargets(
        [next.entry],
        'Mix',
        failure === 'no tracks' ? [] : items,
        store(),
      ),
    ).rejects.toThrow()
    expect(next.session.createPlaylist).not.toHaveBeenCalled()
    if (['scope changed', 'no tracks', 'lookup failed'].includes(failure))
      expect(next.session.replacePlaylist).not.toHaveBeenCalled()
    expect(await getPlaylistExport(db, 1, 1, 1)).toMatchObject({
      state: 'linked',
      remotePlaylistId: 'remote-1',
      remoteScope: 'v1:account',
    })
  })

  it('reports each target outcome without one failure hiding another success', async () => {
    await db.insert(targets).values({ id: 3, userId: 1, name: 'Target', type: 'spotify-playlist' })
    const verified = destination(1, { readBackTrackCount: vi.fn().mockResolvedValue(1) })
    const partial = destination(2, {
      createPlaylist: vi.fn(async (_name, onCreated) => {
        await onCreated('remote-2')
        return {
          success: true,
          targetType: 'spotify-playlist',
          targetId: 2,
          playlistId: 'remote-2',
          itemsAdded: 1,
          itemsSkipped: 2,
        }
      }),
    })
    const failed = destination(3, {
      createPlaylist: vi.fn().mockRejectedValue(new Error(`upstream ${'x'.repeat(400)}`)),
    })
    const report = vi.fn().mockResolvedValue(undefined)
    await expect(
      pushSavedPlaylistToTargets(
        [{ ...verified.entry, targetName: 'Living room' }, partial.entry, failed.entry],
        'Mix',
        items,
        store(),
        report,
      ),
    ).rejects.toThrow(/skipped 2.*spotify-playlist\(3\): upstream/)
    expect(report).toHaveBeenCalledOnce()
    const [outcomes] = report.mock.calls[0] ?? []
    expect(outcomes).toEqual([
      {
        targetId: 1,
        targetName: 'Living room',
        targetType: 'spotify-playlist',
        status: 'submitted',
        verified: true,
        itemsAdded: 1,
        itemsSkipped: 0,
      },
      {
        targetId: 2,
        targetName: 'Target',
        targetType: 'spotify-playlist',
        status: 'partial',
        verified: false,
        itemsAdded: 1,
        itemsSkipped: 2,
      },
      expect.objectContaining({ targetId: 3, status: 'failed', verified: false }),
    ])
    expect(outcomes[2].error).toHaveLength(300)
  })

  it.each([
    ['a mismatched count', vi.fn().mockResolvedValue(5)],
    ['a failed read-back', vi.fn().mockRejectedValue(new Error('read failed'))],
  ])('leaves a successful write unverified after %s', async (_case, readBackTrackCount) => {
    const report = vi.fn().mockResolvedValue(undefined)
    await pushSavedPlaylistToTargets(
      [destination(1, { readBackTrackCount }).entry],
      'Mix',
      items,
      store(),
      report,
    )
    expect(readBackTrackCount).toHaveBeenCalledWith('remote-1')
    expect(report.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ status: 'submitted', verified: false }),
    ])
  })

  it('fails loudly when outcomes cannot be saved, after every target was attempted', async () => {
    const first = destination(1)
    const second = destination(2)
    await expect(
      pushSavedPlaylistToTargets(
        [first.entry, second.entry],
        'Mix',
        items,
        store(),
        vi.fn().mockRejectedValue(new Error('db down')),
      ),
    ).rejects.toThrow('export outcomes could not be saved: db down')
    expect(first.session.createPlaylist).toHaveBeenCalledOnce()
    expect(second.session.createPlaylist).toHaveBeenCalledOnce()
  })

  it('serializes generation and recovery for one playlist while allowing others, and releases after failures', async () => {
    let release = () => {}
    const running = withPlaylistLock(
      1,
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    try {
      await expect(withPlaylistLock(1, async () => {})).rejects.toBeInstanceOf(PlaylistBusyError)
      await expect(withPlaylistLock(2, async () => 'other')).resolves.toBe('other')
    } finally {
      release()
      await running
    }
    await expect(
      withPlaylistLock(1, async () => {
        throw new Error('failed')
      }),
    ).rejects.toThrow('failed')
    await expect(withPlaylistLock(1, async () => 'released')).resolves.toBe('released')
  })
})
