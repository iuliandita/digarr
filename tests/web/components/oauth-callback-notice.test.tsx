// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthCallbackNotice, resolveOAuthNotice } from '@/web/components/oauth-callback-notice'
import { I18nProvider } from '@/web/lib/i18n'

function SearchProbe() {
  return <span data-testid="search">{useLocation().search}</span>
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings${search}`]}>
      <I18nProvider>
        <OAuthCallbackNotice />
        <SearchProbe />
      </I18nProvider>
    </MemoryRouter>,
  )
}

describe('resolveOAuthNotice', () => {
  it.each([
    ['missing_code_or_state', 'oauth.error.missingCodeOrState'],
    ['no_pending_auth', 'oauth.error.noPendingAuth'],
    ['state_expired', 'oauth.error.stateExpired'],
    ['browser_mismatch', 'oauth.error.browserMismatch'],
    ['missing_credentials', 'oauth.error.missingCredentials'],
    ['token_exchange_unreachable', 'oauth.error.tokenExchangeUnreachable'],
    ['token_exchange_failed', 'oauth.error.tokenExchangeFailed'],
    ['token_exchange_malformed', 'oauth.error.tokenExchangeMalformed'],
    ['token_exchange_no_token', 'oauth.error.tokenExchangeNoToken'],
    ['unknown_provider', 'oauth.error.unknownProvider'],
  ])('maps the %s stage to its own message key', (stage, messageKey) => {
    expect(resolveOAuthNotice({ error: stage })).toEqual({
      kind: 'error',
      messageKey,
      rawCode: null,
    })
  })

  it('routes unrecognized provider values through the generic message', () => {
    expect(resolveOAuthNotice({ error: 'access_denied' })).toEqual({
      kind: 'error',
      messageKey: 'oauth.error.generic',
      rawCode: 'access_denied',
    })
  })

  it('strips markup and control characters from a provider-supplied value', () => {
    const notice = resolveOAuthNotice({ error: '<img src=x onerror=alert(1)>' })

    expect(notice).toMatchObject({ kind: 'error', messageKey: 'oauth.error.generic' })
    expect(notice && 'rawCode' in notice ? notice.rawCode : null).toBe('img srcx onerroralert1')
  })

  it('caps an overlong provider-supplied value', () => {
    const notice = resolveOAuthNotice({ error: 'a'.repeat(500) })

    expect(notice && 'rawCode' in notice ? notice.rawCode?.length : null).toBe(64)
  })

  it('drops a value that sanitizes to nothing', () => {
    expect(resolveOAuthNotice({ error: '<<<>>>' })).toEqual({
      kind: 'error',
      messageKey: 'oauth.error.generic',
      rawCode: null,
    })
  })

  it.each([
    ['spotify', 'Spotify'],
    ['deezer', 'Deezer'],
    ['tidal', 'TIDAL'],
  ])('maps the %s success value to its label', (provider, label) => {
    expect(resolveOAuthNotice({ success: provider })).toEqual({
      kind: 'success',
      providerLabel: label,
    })
  })

  it('ignores an unrecognized success provider', () => {
    expect(resolveOAuthNotice({ success: 'evil' })).toBeNull()
  })

  it('returns nothing without params, and prefers the error when both are present', () => {
    expect(resolveOAuthNotice({})).toBeNull()
    expect(resolveOAuthNotice({ error: 'state_expired', success: 'spotify' })).toMatchObject({
      kind: 'error',
      messageKey: 'oauth.error.stateExpired',
    })
  })
})

describe('OAuthCallbackNotice', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => null), setItem: vi.fn() },
    })
  })

  it('renders nothing without callback params', () => {
    renderAt('')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders a stage-specific failure message', () => {
    renderAt('?oauth_error=state_expired')

    expect(screen.getByText('Connection failed')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The connection attempt took longer than 10 minutes and expired. Start it again.',
      ),
    ).toBeInTheDocument()
  })

  it('renders a success confirmation naming the provider', () => {
    renderAt('?oauth_success=tidal')

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('TIDAL is now connected.')).toBeInTheDocument()
  })

  it('shows an unrecognized provider code as inert text under the generic message', () => {
    renderAt('?oauth_error=access_denied')

    expect(
      screen.getByText('The connection could not be completed. Start the connection again.'),
    ).toBeInTheDocument()
    expect(screen.getByText('access_denied').tagName).toBe('CODE')
  })

  it('clears the callback params but keeps the rest of the query', () => {
    renderAt('?tab=connections&oauth_error=state_expired')

    const search = screen.getByTestId('search').textContent ?? ''
    expect(search).not.toContain('oauth_error')
    expect(search).toContain('tab=connections')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
