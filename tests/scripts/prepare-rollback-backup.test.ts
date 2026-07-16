// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareRollbackBackup } from '../../scripts/prepare-rollback-backup'

function completeV1Backup() {
  return {
    version: 1,
    appVersion: '1.13.0',
    createdAt: '2026-07-16T10:00:00.000Z',
    encryptionKeyHash: 'test-fingerprint',
    includesCaches: true,
    data: {
      settings: [{ id: 1, preferences: { theme: 'digarr' } }],
      users: [{ id: 1, username: 'rollback-user' }],
      oauthTokens: [{ id: 1, provider: 'spotify', accessToken: 'oauth-test-value' }],
      targets: [{ id: 1, name: 'rollback-target' }],
      subscriptions: [{ id: 1, name: 'rollback-subscription' }],
      jobRuns: [{ id: 1, type: 'pipeline' }],
      recommendationBatches: [{ id: 1, source: 'manual' }],
      recommendations: [{ id: 1, name: 'Rollback Artist' }],
      playlists: [{ id: 1, name: 'Rollback Playlist' }],
      playlistTracks: [{ id: 1, title: 'Rollback Track' }],
      artists: [{ id: 1, name: 'Rollback Artist' }],
      artistGenreAliases: [{ id: 1, alias: 'alt rock' }],
      genres: [{ id: 1, name: 'Rock' }],
      artistMetadata: [{ id: 1, popularity: 42 }],
      artistBlocks: [{ id: 1, artistId: 1 }],
      albumBlocks: [{ id: 1, releaseGroupMbid: 'release-group' }],
      libraryArtists: [{ id: 1, sourceArtistId: 'artist-source' }],
      libraryAlbums: [{ id: 1, sourceAlbumId: 'album-source' }],
      librarySyncState: [{ id: 1, source: 'lidarr' }],
      libraryMatchOverrides: [{ id: 1, sourceArtistId: 'artist-source' }],
      libraryAlbumMatchOverrides: [{ id: 1, sourceAlbumId: 'album-source' }],
      libraryHealthState: [{ id: 1, checks: [] }],
      recordingArtistCache: [{ id: 1, artistName: 'Rollback Artist' }],
      slskdJobs: [{ id: 1, workKey: 'rollback-work' }],
      subscriptionRuns: [{ id: 1, type: 'subscription' }],
    },
  }
}

function writeBackup(path: string, backup: unknown): string {
  const content = `${JSON.stringify(backup, null, 2)}\n`
  writeFileSync(path, content)
  return content
}

function runCli(args: string[]) {
  return spawnSync('bun', ['scripts/prepare-rollback-backup.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5_000,
  })
}

describe('rollback backup preparation', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'digarr-rollback-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('adds only an empty oidcTokens table to a complete v1 backup', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const backup = completeV1Backup()
    writeBackup(inputPath, backup)

    prepareRollbackBackup(inputPath, outputPath)

    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({
      ...backup,
      data: { ...backup.data, oidcTokens: [] },
    })
    expect(readFileSync(outputPath, 'utf8').endsWith('\n')).toBe(true)
  })

  it('creates the compatibility copy with mode 0600', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, completeV1Backup())

    prepareRollbackBackup(inputPath, outputPath)

    expect(statSync(outputPath).mode & 0o777).toBe(0o600)
  })

  it('leaves the source file byte-for-byte unchanged', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const source = writeBackup(inputPath, completeV1Backup())

    prepareRollbackBackup(inputPath, outputPath)

    expect(readFileSync(inputPath, 'utf8')).toBe(source)
  })

  it('refuses an existing output without changing it', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, completeV1Backup())
    prepareRollbackBackup(inputPath, outputPath)
    const firstOutput = readFileSync(outputPath)

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow('output path already exists')
    expect(readFileSync(outputPath)).toEqual(firstOutput)
  })

  it('rejects the same resolved input and output path before reading', () => {
    const path = join(testDir, 'missing.json')

    expect(() => prepareRollbackBackup(path, path)).toThrow('must differ')
    expect(existsSync(path)).toBe(false)
  })

  it('rejects malformed JSON without creating output', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeFileSync(inputPath, '{"providerToken":"malformed-sentinel"')

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow('not valid JSON')
    expect(existsSync(outputPath)).toBe(false)
  })

  it('rejects a schema-invalid backup without creating output', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, { version: 1, data: {} })

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow(
      'does not match the supported schema',
    )
    expect(existsSync(outputPath)).toBe(false)
  })

  it('rejects an input with an empty oidcTokens table', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const backup = completeV1Backup()
    writeBackup(inputPath, { ...backup, data: { ...backup.data, oidcTokens: [] } })

    expect(() => prepareRollbackBackup(inputPath, outputPath)).toThrow(
      'must not contain oidcTokens',
    )
    expect(existsSync(outputPath)).toBe(false)
  })

  it('rejects provider-token rows without leaking their contents', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const sentinel = 'provider-token-sentinel-387-do-not-emit'
    const backup = completeV1Backup()
    writeBackup(inputPath, {
      ...backup,
      data: { ...backup.data, oidcTokens: [{ id: 1, accessToken: sentinel }] },
    })
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
    let thrown: unknown

    try {
      prepareRollbackBackup(inputPath, outputPath)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('must not contain oidcTokens')
    expect((thrown as Error).message).not.toContain(sentinel)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).not.toHaveBeenCalled()
    expect(existsSync(outputPath)).toBe(false)
  })

  it.each([
    { args: [] },
    { args: ['one.json'] },
    { args: ['one.json', 'two.json', 'three.json'] },
  ])('requires exactly input and output CLI arguments: $args', ({ args }) => {
    const result = runCli(args)

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe(
      'usage: bun scripts/prepare-rollback-backup.ts <input> <output>',
    )
  })

  it('prints only the resolved output path after CLI success', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    writeBackup(inputPath, completeV1Backup())

    const result = runCli([inputPath, outputPath])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${resolve(outputPath)}\n`)
    expect(result.stderr).toBe('')
  })

  it('keeps provider-token contents out of CLI failure output', () => {
    const inputPath = join(testDir, 'input.json')
    const outputPath = join(testDir, 'output.json')
    const sentinel = 'provider-token-sentinel-387-cli'
    const backup = completeV1Backup()
    writeBackup(inputPath, {
      ...backup,
      data: { ...backup.data, oidcTokens: [{ id: 1, refreshToken: sentinel }] },
    })

    const result = runCli([inputPath, outputPath])

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('must not contain oidcTokens')
    expect(result.stderr).not.toContain(sentinel)
    expect(existsSync(outputPath)).toBe(false)
  })
})
