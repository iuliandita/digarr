// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SupportedLocale } from '@/core/i18n/locales'
import { JobRunRow } from '@/web/components/job-run-row'
import type { JobRun } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { loadMessages } from '@/web/lib/locale-catalogs'

describe('JobRunRow source results', () => {
  it.each<[SupportedLocale, NonNullable<JobRun['sourceResults']>[string], string]>([
    [
      'en',
      { status: 'skipped', reason: 'unsupported_capability' },
      'Skipped - Similar-artist lookup is not supported',
    ],
    ['en', { status: 'ok', artists: 0 }, 'Success (0 artists)'],
    [
      'en',
      {
        status: 'ok',
        artists: 50,
        seedsQueried: 30,
        seedsWithResults: 25,
        skipReasons: { artist_unknown: 5 },
      },
      'Success (50 artists) - 30 seeds queried, 25 with results - Artist unknown or no similar artists in the index. (5)',
    ],
    ['en', { status: 'error', error: 'upstream unavailable' }, 'Error - upstream unavailable'],
    ['en', { status: 'skipped', reason: 'future_reason' }, 'Skipped - future_reason'],
    [
      'de',
      { status: 'skipped', reason: 'unsupported_capability' },
      'Übersprungen - Suche nach ähnlichen Künstlern wird nicht unterstützt',
    ],
  ])('renders %s source outcome %j', async (locale, result, expected) => {
    await loadMessages(locale)
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => locale), setItem: vi.fn() },
    })
    const job: JobRun = {
      id: 1,
      type: 'pipeline',
      status: 'completed',
      userId: 1,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: 0,
      error: null,
      metadata: {},
      sourceResults: { [result.seedsQueried != null ? 'audiomuse' : 'spotify']: result },
      subscriptionId: null,
      batchId: null,
    }
    render(
      <I18nProvider>
        <JobRunRow job={job} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})

describe('JobRunRow readability', () => {
  const base: JobRun = {
    id: 2,
    type: 'library_sync',
    status: 'failed',
    userId: 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: 10,
    error: 'connect ECONNREFUSED',
    metadata: { source: 'plex' },
    sourceResults: null,
    subscriptionId: null,
    batchId: null,
  }

  it('names the library source and labels the status in text', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => 'en'), setItem: vi.fn() },
    })
    render(
      <I18nProvider>
        <JobRunRow job={base} />
      </I18nProvider>,
    )
    expect(screen.getByText('Plex')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.queryByText('!')).toBeNull()
  })
})

describe('JobRunRow write-back labels', () => {
  it.each([
    ['listenbrainz', 'love', 'ListenBrainz'],
    ['listenbrainz', 'playlist', 'ListenBrainz'],
    ['lastfm', 'love', 'Last.fm'],
  ])('names %s for a %s operation', (writeBackService, operation, service) => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => 'en'), setItem: vi.fn() },
    })
    const job: JobRun = {
      id: 3,
      type: 'target',
      status: 'completed',
      userId: 1,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: 0,
      error: null,
      metadata: { writeBackService, operation },
      sourceResults: null,
      subscriptionId: null,
      batchId: null,
    }
    render(
      <I18nProvider>
        <JobRunRow job={job} />
      </I18nProvider>,
    )
    expect(screen.getByText(`${service} write-back`)).toBeInTheDocument()
    expect(screen.queryByText('Target operation')).toBeNull()
  })
})
