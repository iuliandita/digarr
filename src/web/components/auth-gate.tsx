import { useEffect, useState } from 'react'
import { errMsg } from '@/core/validation'
import {
  AUTH_EXPIRED_EVENT,
  clearStoredToken,
  getAuthStatus,
  getStoredToken,
  loginUser,
  registerUser,
  setStoredToken,
} from '../lib/api'
import { useI18n } from '../lib/i18n'
import { LanguageSwitcher } from './language-switcher'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type AuthState = 'loading' | 'not-required' | 'register' | 'login' | 'authenticated'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')
  const [hasUsers, setHasUsers] = useState(false)
  const [oidcEnabled, setOidcEnabled] = useState(false)

  useEffect(() => {
    async function validateToken(token: string): Promise<boolean> {
      const res = await fetch('/api/v1/auth/validate', {
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.ok
    }

    async function checkAuth() {
      try {
        // Handle OIDC callback - token or error passed in URL fragment (#)
        // Fragments never leak to server logs or Referer headers
        const hash = window.location.hash.slice(1) // strip leading #
        const hashParams = new URLSearchParams(hash)
        const oidcToken = hashParams.get('oidc_token')
        const oidcError = hashParams.get('oidc_error')

        if (oidcToken) {
          window.history.replaceState({}, '', window.location.pathname)
          setStoredToken(oidcToken)
          setState('authenticated')
          return
        }

        if (oidcError) {
          window.history.replaceState({}, '', window.location.pathname)
          // Fall through - show login with the error visible via state
        }

        const status = await getAuthStatus()
        setHasUsers(status.hasUsers)
        setOidcEnabled(status.oidcEnabled ?? false)
        // Version moved to /api/auth/meta (auth-gated) to avoid leaking the
        // build fingerprint to unauthenticated visitors. Login screen no
        // longer displays it.

        if (!status.required) {
          setState('not-required')
          return
        }

        // Cookie-backed auth (proxy-auth / OIDC callback / password login). The
        // server already validated the session cookie on /api/auth/status, so
        // authenticated === true means subsequent API calls will succeed.
        if (status.authenticated) {
          setState('authenticated')
          return
        }

        const stored = getStoredToken()
        if (stored) {
          if (await validateToken(stored)) {
            setState('authenticated')
            return
          }
          clearStoredToken()
        }

        setState(status.hasUsers ? 'login' : 'register')
      } catch {
        // Can't reach server - render children and let it fail naturally
        setState('not-required')
      }
    }
    checkAuth()
  }, [])

  // Listen for 401s from fetchApi and return to login
  useEffect(() => {
    const handler = () => {
      setState(hasUsers ? 'login' : 'register')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handler)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler)
  }, [hasUsers])

  function handleAuthenticated(token: string) {
    setStoredToken(token)
    setState('authenticated')
  }

  if (state === 'loading') return null
  if (state === 'not-required' || state === 'authenticated') return <>{children}</>
  if (state === 'register') {
    return (
      <RegisterForm onSuccess={handleAuthenticated} onSwitchToLogin={() => setState('login')} />
    )
  }
  return (
    <LoginForm
      onSuccess={handleAuthenticated}
      onSwitchToRegister={() => setState('register')}
      oidcEnabled={oidcEnabled}
    />
  )
}

// Login form (username/password + legacy token fallback)

function LoginForm({
  onSuccess,
  onSwitchToRegister,
  oidcEnabled,
}: {
  onSuccess: (token: string) => void
  onSwitchToRegister: () => void
  oidcEnabled?: boolean
}) {
  const { locale, setLocale, t } = useI18n()
  const [mode, setMode] = useState<'credentials' | 'token'>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
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
      const res = await loginUser(username.trim(), password)
      onSuccess(res.token)
    } catch (err: unknown) {
      setError(errMsg(err).includes('401') ? t('auth.invalidCredentials') : t('auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleTokenLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!token.trim()) {
      setError(t('auth.tokenRequired'))
      return
    }
    const res = await fetch('/api/v1/auth/validate', {
      headers: { Authorization: `Bearer ${token.trim()}` },
    })
    if (res.status === 401) {
      setError(t('auth.invalidToken'))
      return
    }
    onSuccess(token.trim())
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <span className="text-accent">digarr</span>
          </CardTitle>
          <CardDescription>
            {mode === 'credentials' ? t('auth.loginDescription') : t('auth.tokenDescription')}
          </CardDescription>
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
          {mode === 'credentials' ? (
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
                {error && <p className="text-sm text-reject">{error}</p>}
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
                <button
                  type="button"
                  onClick={() => {
                    setMode('token')
                    setError(null)
                  }}
                  className="text-muted hover:text-text"
                >
                  {t('auth.useAccessToken')}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleTokenLogin} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder={t('auth.accessToken')}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoFocus
                />
                {error && <p className="text-sm text-reject">{error}</p>}
              </div>
              <Button type="submit" className="w-full">
                {t('auth.signIn')}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setMode('credentials')
                  setError(null)
                }}
                className="text-sm text-muted hover:text-text"
              >
                {t('auth.useUsernamePassword')}
              </button>
            </form>
          )}
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
  onSuccess,
  onSwitchToLogin,
}: {
  onSuccess: (token: string) => void
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
      const res = await registerUser(username.trim(), password)
      onSuccess(res.token)
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
              {error && <p className="text-sm text-reject">{error}</p>}
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
