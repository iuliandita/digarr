import { useEffect, useRef, useState } from 'react'
import type { MessageKey } from '@/core/i18n/messages/types'
import { errMsg } from '@/core/validation'
import {
  AUTH_EXPIRED_EVENT,
  clearStoredToken,
  getAuthStatus,
  getLegacyStoredToken,
  loginUser,
  migrateLegacySession,
  registerUser,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import { LanguageSwitcher } from './language-switcher'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type AuthState = 'loading' | 'not-required' | 'register' | 'login' | 'authenticated'
type AuthFragment = { retiredToken: boolean; oidcError: boolean }
type MigrationRetryState = 'fresh' | 'retry' | 'unavailable'

const MIGRATION_RETRY_KEY = 'digarr-session-migration-retry'

function getMigrationRetryState(): MigrationRetryState {
  try {
    return window.sessionStorage.getItem(MIGRATION_RETRY_KEY) === null ? 'fresh' : 'retry'
  } catch {
    return 'unavailable'
  }
}

function markMigrationForRetry(): boolean {
  try {
    window.sessionStorage.setItem(MIGRATION_RETRY_KEY, '1')
    return true
  } catch {
    return false
  }
}

function clearMigrationRetryMarker() {
  try {
    window.sessionStorage.removeItem(MIGRATION_RETRY_KEY)
  } catch {
    // An unavailable marker store is already a fail-secure state.
  }
}

function clearLegacyMigrationState() {
  clearStoredToken()
  clearMigrationRetryMarker()
}

function consumeAuthFragment(): AuthFragment {
  const hash = window.location.hash
  const params = new URLSearchParams(hash.slice(1))
  const fragment = {
    retiredToken: params.has('oidc_token'),
    oidcError: params.has('oidc_error'),
  }
  if (fragment.retiredToken || fragment.oidcError) {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
  }
  return fragment
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const fragment = useRef<AuthFragment | null>(null)
  if (!fragment.current) fragment.current = consumeAuthFragment()

  const [state, setState] = useState<AuthState>('loading')
  const [hasUsers, setHasUsers] = useState(false)
  const [oidcEnabled, setOidcEnabled] = useState(false)
  const [notice, setNotice] = useState<MessageKey | null>(
    fragment.current.oidcError
      ? 'auth.loginFailed'
      : fragment.current.retiredToken
        ? 'auth.legacyTokenMigrationRequired'
        : null,
  )
  const authCheckStarted = useRef(false)

  useEffect(() => {
    if (authCheckStarted.current) return
    authCheckStarted.current = true

    function applyStatus(
      status: Awaited<ReturnType<typeof getAuthStatus>>,
      allowAuthenticated: boolean,
    ) {
      setHasUsers(status.hasUsers)
      setOidcEnabled(status.oidcEnabled ?? false)

      if (!status.required && allowAuthenticated) {
        setState('not-required')
      } else if (status.authenticated && allowAuthenticated) {
        setState('authenticated')
      } else {
        setState(status.hasUsers ? 'login' : 'register')
      }
    }

    async function requireLoginAfterMigrationFailure() {
      try {
        applyStatus(await getAuthStatus(), false)
      } catch {
        setHasUsers(true)
        setState('login')
      }
    }

    async function checkAuth() {
      const legacyToken = getLegacyStoredToken()
      let allowAuthenticated = !fragment.current?.oidcError

      if (legacyToken) {
        const retryState = getMigrationRetryState()
        try {
          const result = await migrateLegacySession(legacyToken)
          clearLegacyMigrationState()
          if (result === 'legacy-rejected') {
            setNotice('auth.legacyTokenMigrationRequired')
            allowAuthenticated = false
          } else if (result === 'invalid') {
            setNotice('auth.sessionMigrationFailed')
            allowAuthenticated = false
          }
        } catch {
          if (retryState !== 'fresh' || !markMigrationForRetry()) {
            clearLegacyMigrationState()
          }
          setNotice('auth.sessionMigrationFailed')
          await requireLoginAfterMigrationFailure()
          return
        }
      } else {
        clearMigrationRetryMarker()
      }

      try {
        const status = await getAuthStatus()
        applyStatus(status, allowAuthenticated)
      } catch {
        setNotice((current) => current ?? 'auth.loginFailed')
        setHasUsers(true)
        setState('login')
      }
    }
    void checkAuth()
  }, [])

  // Listen for 401s from fetchApi and return to login
  useEffect(() => {
    const handler = () => {
      setNotice(null)
      setState(hasUsers ? 'login' : 'register')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handler)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler)
  }, [hasUsers])

  async function handleAuthenticated(fallback: 'login' | 'register') {
    setNotice(null)
    clearLegacyMigrationState()
    try {
      const status = await getAuthStatus()
      setHasUsers(status.hasUsers)
      setOidcEnabled(status.oidcEnabled ?? false)
      if (!status.required) {
        setState('not-required')
      } else if (status.authenticated) {
        setState('authenticated')
      } else {
        setNotice('auth.sessionCookieRejected')
        setState(status.hasUsers ? 'login' : 'register')
      }
    } catch {
      setNotice('auth.sessionVerificationFailed')
      setState(fallback)
    }
  }

  if (state === 'loading') return null
  if (state === 'not-required' || state === 'authenticated') return <>{children}</>
  if (state === 'register') {
    return (
      <RegisterForm
        notice={notice}
        onSuccess={() => handleAuthenticated('register')}
        onSwitchToLogin={() => {
          setNotice(null)
          setState('login')
        }}
      />
    )
  }
  return (
    <LoginForm
      notice={notice}
      onSuccess={() => handleAuthenticated('login')}
      onSwitchToRegister={() => {
        setNotice(null)
        setState('register')
      }}
      oidcEnabled={oidcEnabled}
    />
  )
}

// Login form

function LoginForm({
  notice,
  onSuccess,
  onSwitchToRegister,
  oidcEnabled,
}: {
  notice: MessageKey | null
  onSuccess: () => Promise<void>
  onSwitchToRegister: () => void
  oidcEnabled?: boolean
}) {
  const { locale, setLocale, t } = useI18n()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!username.trim() || !password) {
      setError(t('auth.credentialsRequired'))
      return
    }
    setLoading(true)
    try {
      await loginUser(username.trim(), password)
      await onSuccess()
    } catch (err: unknown) {
      setError(errMsg(err).includes('401') ? t('auth.invalidCredentials') : t('auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <span className="text-accent">digarr</span>
          </CardTitle>
          <CardDescription>{t('auth.loginDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {oidcEnabled && (
            <div className="space-y-3 mb-4">
              <a
                href="/api/v1/auth/oidc/login"
                className="block w-full text-center px-4 py-2 rounded bg-accent text-accent-fg font-medium hover:bg-accent/90"
              >
                {t('auth.signInWithSso')}
              </a>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-bg px-2 text-muted">{t('auth.or')}</span>
                </div>
              </div>
            </div>
          )}
          <form onSubmit={handleCredentialLogin} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder={t('auth.username')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
              <Input
                type="password"
                placeholder={t('auth.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              {(error || notice) && (
                <p className="text-sm text-reject">{error ?? (notice ? t(notice) : null)}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="text-muted hover:text-text"
              >
                {t('auth.createAccount')}
              </button>
            </div>
          </form>
          <div className="mt-4 flex justify-center">
            <LanguageSwitcher value={locale} onChange={setLocale} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Registration form (first-time setup)

function RegisterForm({
  notice,
  onSuccess,
  onSwitchToLogin,
}: {
  notice: MessageKey | null
  onSuccess: () => Promise<void>
  onSwitchToLogin: () => void
}) {
  const { locale, setLocale, t } = useI18n()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!username.trim()) {
      setError(t('auth.usernameRequired'))
      return
    }
    if (password.length < 12) {
      setError(t('auth.passwordMinError'))
      return
    }
    setLoading(true)
    try {
      await registerUser(username.trim(), password)
      await onSuccess()
    } catch (err: unknown) {
      const msg = errMsg(err)
      if (msg.includes('409')) {
        setError(t('auth.usernameTaken'))
      } else if (msg.includes('400')) {
        setError(t('auth.invalidInput'))
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <span className="text-accent">digarr</span>
          </CardTitle>
          <CardDescription>{t('auth.registerDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder={t('auth.username')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
              <Input
                type="password"
                placeholder={t('auth.passwordMin')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              {(error || notice) && (
                <p className="text-sm text-reject">{error ?? (notice ? t(notice) : null)}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.creatingAccount') : t('auth.createAccount')}
            </Button>
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-sm text-muted hover:text-text"
            >
              {t('auth.alreadyHaveAccount')}
            </button>
          </form>
          <div className="mt-4 flex justify-center">
            <LanguageSwitcher value={locale} onChange={setLocale} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
