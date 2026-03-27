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
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type AuthState = 'loading' | 'not-required' | 'register' | 'login' | 'authenticated'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')
  const [hasUsers, setHasUsers] = useState(false)
  const [oidcEnabled, setOidcEnabled] = useState(false)
  const [version, setVersion] = useState<string>()

  useEffect(() => {
    async function checkAuth() {
      try {
        // Handle OIDC callback -- token or error passed in URL fragment (#)
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
          // Fall through -- show login with the error visible via state
        }

        const status = await getAuthStatus()
        setHasUsers(status.hasUsers)
        setOidcEnabled(status.oidcEnabled ?? false)
        setVersion(status.version)

        if (!status.required) {
          setState('not-required')
          return
        }

        // Proxy auth -- backend resolved the identity and issued a token
        if (status.proxyAuth && status.token) {
          setStoredToken(status.token)
          setState('authenticated')
          return
        }

        const stored = getStoredToken()
        if (stored) {
          // Verify stored token against a protected endpoint
          const res = await fetch('/api/setup/status', {
            headers: { Authorization: `Bearer ${stored}` },
          })
          if (res.ok) {
            setState('authenticated')
            return
          }
          clearStoredToken()
        }

        setState(status.hasUsers ? 'login' : 'register')
      } catch {
        // Can't reach server -- render children and let it fail naturally
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
      <RegisterForm
        onSuccess={handleAuthenticated}
        onSwitchToLogin={() => setState('login')}
        version={version}
      />
    )
  }
  return (
    <LoginForm
      onSuccess={handleAuthenticated}
      onSwitchToRegister={() => setState('register')}
      oidcEnabled={oidcEnabled}
      version={version}
    />
  )
}

// ---------------------------------------------------------------------------
// Login form (username/password + legacy token fallback)
// ---------------------------------------------------------------------------

function LoginForm({
  onSuccess,
  onSwitchToRegister,
  oidcEnabled,
  version,
}: {
  onSuccess: (token: string) => void
  onSwitchToRegister: () => void
  oidcEnabled?: boolean
  version?: string
}) {
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
      setError('Username and password are required')
      return
    }
    setLoading(true)
    try {
      const res = await loginUser(username.trim(), password)
      onSuccess(res.token)
    } catch (err: unknown) {
      setError(errMsg(err).includes('401') ? 'Invalid credentials' : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleTokenLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!token.trim()) {
      setError('Token is required')
      return
    }
    // Verify the token against a protected endpoint
    const res = await fetch('/api/setup/status', {
      headers: { Authorization: `Bearer ${token.trim()}` },
    })
    if (res.status === 401) {
      setError('Invalid token')
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
            {mode === 'credentials' ? 'Sign in with your account.' : 'Enter your access token.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {oidcEnabled && (
            <div className="space-y-3 mb-4">
              <a
                href="/api/auth/oidc/login"
                className="block w-full text-center px-4 py-2 rounded bg-accent text-accent-fg font-medium hover:bg-accent/90"
              >
                Sign in with SSO
              </a>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-bg px-2 text-muted">or</span>
                </div>
              </div>
            </div>
          )}
          {mode === 'credentials' ? (
            <form onSubmit={handleCredentialLogin} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                {error && <p className="text-sm text-reject">{error}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={onSwitchToRegister}
                  className="text-muted hover:text-text"
                >
                  Create account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('token')
                    setError(null)
                  }}
                  className="text-muted hover:text-text"
                >
                  Use access token
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleTokenLogin} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Access token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoFocus
                />
                {error && <p className="text-sm text-reject">{error}</p>}
              </div>
              <Button type="submit" className="w-full">
                Sign in
              </Button>
              <button
                type="button"
                onClick={() => {
                  setMode('credentials')
                  setError(null)
                }}
                className="text-sm text-muted hover:text-text"
              >
                Use username & password
              </button>
            </form>
          )}
        </CardContent>
      </Card>
      {version && <p className="text-xs text-muted mt-4 text-center">v{version}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Registration form (first-time setup)
// ---------------------------------------------------------------------------

function RegisterForm({
  onSuccess,
  onSwitchToLogin,
  version,
}: {
  onSuccess: (token: string) => void
  onSwitchToLogin: () => void
  version?: string
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!username.trim()) {
      setError('Username is required')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      const res = await registerUser(username.trim(), password)
      onSuccess(res.token)
    } catch (err: unknown) {
      const msg = errMsg(err)
      if (msg.includes('409')) {
        setError('Username already taken')
      } else if (msg.includes('400')) {
        setError('Invalid input')
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
          <CardDescription>Create the first account to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
              <Input
                type="password"
                placeholder="Password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              {error && <p className="text-sm text-reject">{error}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creating account...' : 'Create account'}
            </Button>
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="text-sm text-muted hover:text-text"
            >
              Already have an account? Sign in
            </button>
          </form>
        </CardContent>
      </Card>
      {version && <p className="text-xs text-muted mt-4 text-center">v{version}</p>}
    </div>
  )
}
