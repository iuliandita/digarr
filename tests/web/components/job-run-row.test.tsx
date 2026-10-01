// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { JobRunRow } from '@/web/components/job-run-row'
import type { JobRun } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

describe('JobRunRow source results', () => {
  it.each<[string, NonNullable<JobRun['sourceResults']>[string], string]>([
    [
      'en',
      { status: 'skipped', reason: 'unsupported_capability' },
      'Skipped - Similar-artist lookup is not supported',
    ],
    ['en', { status: 'ok', artists: 0 }, 'Success (0 artists)'],
    ['en', { status: 'error', error: 'upstream unavailable' }, 'Error - upstream unavailable'],
    ['en', { status: 'skipped', reason: 'future_reason' }, 'Skipped - future_reason'],
    [
      'de',
      { status: 'skipped', reason: 'unsupported_capability' },
      'Übersprungen - Suche nach ähnlichen Künstlern wird nicht unterstützt',
    ],
  ])('renders %s source outcome %j', (locale, result, expected) => {
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
      sourceResults: { spotify: result },
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
