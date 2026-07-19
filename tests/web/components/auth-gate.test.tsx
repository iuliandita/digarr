// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from '@/web/components/auth-gate'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', () => ({
  detectBrowserLocale: vi.fn(() => 'en'),
  getRequestLocale: vi.fn(() => 'en'),
  getStoredLocale: vi.fn(() => 'en'),
  setStoredLocale: vi.fn(),
}))

const apiMocks = vi.hoisted(() => ({
  clearStoredToken: vi.fn(),
  getAuthStatus: vi.fn(),
  getLegacyStoredToken: vi.fn(),
  loginUser: vi.fn(),
  migrateLegacySession: vi.fn(),
  registerUser: vi.fn(),
}))

vi.mock('@/web/lib/api', () => ({
  AUTH_EXPIRED_EVENT: 'digarr:auth-expired',
  clearStoredToken: apiMocks.clearStoredToken,
  getAuthStatus: apiMocks.getAuthStatus,
  getLegacyStoredToken: apiMocks.getLegacyStoredToken,
  loginUser: apiMocks.loginUser,
  migrateLegacySession: apiMocks.migrateLegacySession,
  registerUser: apiMocks.registerUser,
}))

const unauthenticatedStatus = {
  required: true,
  hasUsers: true,
  authenticated: false,
  oidcEnabled: false,
}

const authenticatedStatus = {
  ...unauthenticatedStatus,
  authenticated: true,
  userId: 1,
  isAdmin: true,
}

const migrationRetryKey = 'digarr-session-migration-retry'

function renderGate({ strict = false }: { strict?: boolean } = {}) {
  const gate = (
    <I18nProvider>
      <AuthGate>
        <div>secret area</div>
      </AuthGate>
    </I18nProvider>
  )
  return render(strict ? <StrictMode>{gate}</StrictMode> : gate)
}

async function submitLogin() {
  fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByPlaceholderText('Password'), {
    target: { value: 'correct horse battery staple' },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await Promise.resolve()
  })
}

async function submitRegistration() {
  fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByPlaceholderText('Password (min 12 characters)'), {
    target: { value: 'correct horse battery staple' },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await Promise.resolve()
  })
}

describe('AuthGate', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.clearAllMocks()
    apiMocks.getAuthStatus.mockResolvedValue(unauthenticatedStatus)
    apiMocks.getLegacyStoredToken.mockReturnValue(null)
    apiMocks.loginUser.mockResolvedValue({
      user: { id: 1, username: 'admin', isAdmin: true },
    })
    apiMocks.migrateLegacySession.mockResolvedValue('migrated')
    apiMocks.registerUser.mockResolvedValue({
      user: { id: 1, username: 'admin', isAdmin: true },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    )
  })

  it('migrates a stored browser session before trusting cookie auth', async () => {
    window.sessionStorage.setItem(migrationRetryKey, '1')
    apiMocks.getLegacyStoredToken.mockReturnValue('stored-session')
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    renderGate()

    await screen.findByText('secret area')
    expect(apiMocks.migrateLegacySession).toHaveBeenCalledWith('stored-session')
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBeNull()
    expect(apiMocks.migrateLegacySession.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.getAuthStatus.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('clears an invalid stored session and requires login despite another cookie', async () => {
    window.sessionStorage.setItem(migrationRetryKey, '1')
    apiMocks.getLegacyStoredToken.mockReturnValue('invalid-session')
    apiMocks.migrateLegacySession.mockResolvedValue('invalid')
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    renderGate()

    expect(
      await screen.findByText('Your saved browser session could not be upgraded. Sign in again.'),
    ).toBeInTheDocument()
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBeNull()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('explains that browser access-token login was retired', async () => {
    window.sessionStorage.setItem(migrationRetryKey, '1')
    apiMocks.getLegacyStoredToken.mockReturnValue('legacy-deployment-token')
    apiMocks.migrateLegacySession.mockResolvedValue('legacy-rejected')

    renderGate()

    expect(
      await screen.findByText(
        'Browser access-token sign-in has been retired. Sign in with your account or SSO.',
      ),
    ).toBeInTheDocument()
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBeNull()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('keeps a stored session for one retry after a transient migration failure', async () => {
    apiMocks.getLegacyStoredToken.mockReturnValue('retryable-session')
    apiMocks.migrateLegacySession.mockRejectedValue(new Error('network unavailable'))
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    renderGate()

    expect(
      await screen.findByText('Your saved browser session could not be upgraded. Sign in again.'),
    ).toBeInTheDocument()
    expect(apiMocks.clearStoredToken).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBe('1')
    expect(apiMocks.getAuthStatus).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('ignores a scrubbed fragment token and requires normal login', async () => {
    window.history.replaceState({}, '', '/#oidc_token=fragment-session')

    renderGate()

    expect(window.location.hash).toBe('')
    expect(
      await screen.findByText(
        'Browser access-token sign-in has been retired. Sign in with your account or SSO.',
      ),
    ).toBeInTheDocument()
    expect(apiMocks.getLegacyStoredToken).toHaveBeenCalledTimes(1)
    expect(apiMocks.migrateLegacySession).not.toHaveBeenCalled()
    expect(apiMocks.clearStoredToken).not.toHaveBeenCalled()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('clears a consumed stored session when a replay becomes invalid', async () => {
    apiMocks.getLegacyStoredToken.mockReturnValue('consumed-session')
    apiMocks.migrateLegacySession
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce('invalid')
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    const firstRender = renderGate()
    await screen.findByText('Your saved browser session could not be upgraded. Sign in again.')
    expect(apiMocks.clearStoredToken).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBe('1')
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
    firstRender.unmount()

    renderGate()
    await waitFor(() => expect(apiMocks.migrateLegacySession).toHaveBeenCalledTimes(2))
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBeNull()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('clears a stored session after a second transient migration failure', async () => {
    apiMocks.getLegacyStoredToken.mockReturnValue('retryable-session')
    apiMocks.migrateLegacySession.mockRejectedValue(new Error('network unavailable'))
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    const firstRender = renderGate()
    await screen.findByText('Your saved browser session could not be upgraded. Sign in again.')
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBe('1')
    expect(apiMocks.clearStoredToken).not.toHaveBeenCalled()
    firstRender.unmount()

    renderGate()
    await waitFor(() => expect(apiMocks.migrateLegacySession).toHaveBeenCalledTimes(2))
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBeNull()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('fails secure when the migration retry marker is unavailable', async () => {
    const storageError = new DOMException('blocked', 'SecurityError')
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => {
        throw storageError
      }),
      setItem: vi.fn(() => {
        throw storageError
      }),
      removeItem: vi.fn(() => {
        throw storageError
      }),
    })
    apiMocks.getLegacyStoredToken.mockReturnValue('retryable-session')
    apiMocks.migrateLegacySession.mockRejectedValue(new Error('network unavailable'))
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    renderGate()

    await screen.findByText('Your saved browser session could not be upgraded. Sign in again.')
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(apiMocks.getAuthStatus).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('scrubs a fragment token without replacing an authenticated victim session', async () => {
    const historyState = { navigation: 'victim' }
    window.history.replaceState(historyState, '', '/?return=preserved#oidc_token=attacker-session')
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)
    const replaceState = vi.spyOn(window.history, 'replaceState')

    renderGate()

    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('?return=preserved')
    expect(window.location.hash).toBe('')
    expect(replaceState).toHaveBeenCalledWith(historyState, '', '/?return=preserved')
    await screen.findByText('secret area')
    expect(apiMocks.migrateLegacySession).not.toHaveBeenCalled()
    expect(apiMocks.getLegacyStoredToken).toHaveBeenCalledTimes(1)
    expect(apiMocks.clearStoredToken).not.toHaveBeenCalled()
  })

  it('migrates only the stored session when a fragment token is also present', async () => {
    window.history.replaceState({}, '', '/#oidc_token=attacker-session')
    apiMocks.getLegacyStoredToken.mockReturnValue('stored-session')
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    renderGate()

    await screen.findByText('secret area')
    expect(apiMocks.migrateLegacySession).toHaveBeenCalledTimes(1)
    expect(apiMocks.migrateLegacySession).toHaveBeenCalledWith('stored-session')
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
  })

  it('does not switch identity for an ambiguous OIDC fragment', async () => {
    window.history.replaceState({}, '', '/#oidc_token=attacker-session&oidc_error=oidc_failed')
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    renderGate()

    expect(window.location.hash).toBe('')
    expect(await screen.findByText('Login failed')).toBeInTheDocument()
    expect(apiMocks.migrateLegacySession).not.toHaveBeenCalled()
    expect(apiMocks.clearStoredToken).not.toHaveBeenCalled()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('scrubs a recognized error fragment and shows a safe localized OIDC error', async () => {
    window.history.replaceState({}, '', '/#oidc_error=oidc_failed')

    renderGate()

    expect(window.location.hash).toBe('')
    expect(await screen.findByText('Login failed')).toBeInTheDocument()
    expect(apiMocks.migrateLegacySession).not.toHaveBeenCalled()
  })

  it('preserves ordinary navigation anchors', async () => {
    window.history.replaceState({ navigation: 'section' }, '', '/?view=details#albums')
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)
    const replaceState = vi.spyOn(window.history, 'replaceState')

    renderGate()

    await screen.findByText('secret area')
    expect(window.location.search).toBe('?view=details')
    expect(window.location.hash).toBe('#albums')
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('uses cookie-authenticated status when no legacy session exists', async () => {
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    renderGate()

    await screen.findByText('secret area')
    expect(apiMocks.migrateLegacySession).not.toHaveBeenCalled()
    expect(apiMocks.clearStoredToken).not.toHaveBeenCalled()
  })

  it('mounts children when authentication is not required', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      required: false,
      hasUsers: false,
      authenticated: false,
      oidcEnabled: false,
    })

    renderGate()

    await screen.findByText('secret area')
  })

  it('does not replay migration when React re-enters the mount effect', async () => {
    apiMocks.getLegacyStoredToken.mockReturnValue('stored-session')
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)

    renderGate({ strict: true })

    await screen.findByText('secret area')
    expect(apiMocks.migrateLegacySession).toHaveBeenCalledTimes(1)
  })

  it('rechecks cookie status after password login before mounting children', async () => {
    apiMocks.getAuthStatus
      .mockResolvedValueOnce(unauthenticatedStatus)
      .mockResolvedValueOnce(authenticatedStatus)
    renderGate()
    await screen.findByRole('button', { name: 'Sign in' })

    await submitLogin()

    await screen.findByText('secret area')
    expect(apiMocks.loginUser).toHaveBeenCalledWith('admin', 'correct horse battery staple')
    expect(apiMocks.getAuthStatus).toHaveBeenCalledTimes(2)
  })

  it('clears a retained legacy session after successful password login', async () => {
    apiMocks.getLegacyStoredToken.mockReturnValue('retryable-session')
    apiMocks.migrateLegacySession.mockRejectedValue(new Error('network unavailable'))
    apiMocks.getAuthStatus
      .mockResolvedValueOnce(unauthenticatedStatus)
      .mockResolvedValueOnce(authenticatedStatus)
    renderGate()
    await screen.findByText('Your saved browser session could not be upgraded. Sign in again.')

    await submitLogin()

    await screen.findByText('secret area')
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBeNull()
  })

  it('clears legacy state before reporting a login session verification failure', async () => {
    apiMocks.getLegacyStoredToken.mockReturnValue('retryable-session')
    apiMocks.migrateLegacySession.mockRejectedValue(new Error('network unavailable'))
    apiMocks.getAuthStatus
      .mockResolvedValueOnce(unauthenticatedStatus)
      .mockRejectedValueOnce(new Error('verification unavailable'))
    renderGate()
    await screen.findByText('Your saved browser session could not be upgraded. Sign in again.')

    await submitLogin()

    expect(
      await screen.findByText(
        'The session could not be verified. Check your connection and try again.',
      ),
    ).toBeInTheDocument()
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBeNull()
    expect(apiMocks.clearStoredToken.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.getAuthStatus.mock.invocationCallOrder[1] ?? 0,
    )
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('does not mount children when the browser rejects the login cookie', async () => {
    renderGate()
    await screen.findByRole('button', { name: 'Sign in' })

    await submitLogin()

    expect(
      await screen.findByText(
        'The browser did not accept the session cookie. Check the public URL and HTTPS configuration.',
      ),
    ).toBeInTheDocument()
    expect(apiMocks.getAuthStatus).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('rechecks cookie status after registration before mounting children', async () => {
    apiMocks.getAuthStatus
      .mockResolvedValueOnce({ ...unauthenticatedStatus, hasUsers: false })
      .mockResolvedValueOnce(authenticatedStatus)
    renderGate()
    await screen.findByRole('button', { name: 'Create account' })

    await submitRegistration()

    await screen.findByText('secret area')
    expect(apiMocks.registerUser).toHaveBeenCalledWith('admin', 'correct horse battery staple')
    expect(apiMocks.getAuthStatus).toHaveBeenCalledTimes(2)
  })

  it('does not mount children when the browser rejects the registration cookie', async () => {
    apiMocks.getAuthStatus
      .mockResolvedValueOnce({ ...unauthenticatedStatus, hasUsers: false })
      .mockResolvedValueOnce(unauthenticatedStatus)
    renderGate()
    await screen.findByRole('button', { name: 'Create account' })

    await submitRegistration()

    expect(
      await screen.findByText(
        'The browser did not accept the session cookie. Check the public URL and HTTPS configuration.',
      ),
    ).toBeInTheDocument()
    expect(apiMocks.getAuthStatus).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('clears legacy state before reporting a registration session verification failure', async () => {
    apiMocks.getLegacyStoredToken.mockReturnValue('retryable-session')
    apiMocks.migrateLegacySession.mockRejectedValue(new Error('network unavailable'))
    apiMocks.getAuthStatus
      .mockResolvedValueOnce({ ...unauthenticatedStatus, hasUsers: false })
      .mockRejectedValueOnce(new Error('verification unavailable'))
    renderGate()
    await screen.findByText('Your saved browser session could not be upgraded. Sign in again.')

    await submitRegistration()

    expect(
      await screen.findByText(
        'The session could not be verified. Check your connection and try again.',
      ),
    ).toBeInTheDocument()
    expect(apiMocks.clearStoredToken).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(migrationRetryKey)).toBeNull()
    expect(apiMocks.clearStoredToken.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.getAuthStatus.mock.invocationCallOrder[1] ?? 0,
    )
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })

  it('returns to normal login when the cookie session expires', async () => {
    apiMocks.getAuthStatus.mockResolvedValue(authenticatedStatus)
    renderGate()
    await screen.findByText('secret area')

    act(() => window.dispatchEvent(new Event('digarr:auth-expired')))

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })
})
