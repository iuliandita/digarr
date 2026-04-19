import type { APIRequestContext, Page } from '@playwright/test'
import type { SupportedLocale } from '@/core/i18n/locales'

const E2E_ADMIN_USERNAME = 'setup-e2e'
const E2E_ADMIN_PASSWORD = 'e2e-password-123'

async function loginOrRegister(request: APIRequestContext): Promise<string | null> {
  const authStatusRes = await request.get('/api/v1/auth/status')
  if (!authStatusRes.ok()) return null

  const authStatus = (await authStatusRes.json()) as { hasUsers?: boolean }
  let token: string | null = null

  if (!authStatus.hasUsers) {
    const registerRes = await request.post('/api/v1/auth/register', {
      data: {
        username: E2E_ADMIN_USERNAME,
        password: E2E_ADMIN_PASSWORD,
      },
    })
    if (registerRes.ok()) {
      const registerBody = (await registerRes.json()) as { token?: string }
      token = registerBody.token ?? null
    }
  }

  if (!token) {
    const loginRes = await request.post('/api/v1/auth/login', {
      data: {
        username: E2E_ADMIN_USERNAME,
        password: E2E_ADMIN_PASSWORD,
      },
    })
    if (!loginRes.ok()) return null
    const loginBody = (await loginRes.json()) as { token?: string }
    token = loginBody.token ?? null
  }

  return token
}

export async function ensureAdminToken(
  request: APIRequestContext,
  options: { completeSetup?: boolean; preferredLocale?: SupportedLocale | null } = {},
): Promise<string | null> {
  const token = await loginOrRegister(request)
  if (!token) return null

  const meRes = await request.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!meRes.ok()) return null
  const me = (await meRes.json()) as { isAdmin?: boolean }
  if (!me.isAdmin) return null

  const preferredLocale = options.preferredLocale ?? 'en'
  const setLocale = async () => {
    const localeRes = await request.patch('/api/v1/auth/me/locale', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        preferredLocale,
      },
    })
    return localeRes.ok()
  }

  if (!options.completeSetup) {
    return (await setLocale()) ? token : null
  }

  const setupStatusRes = await request.get('/api/v1/setup/status', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!setupStatusRes.ok()) return null
  const setupStatus = (await setupStatusRes.json()) as { setupComplete?: boolean }

  if (!setupStatus.setupComplete) {
    const completeRes = await request.post('/api/v1/setup/complete', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        aiProvider: 'openai',
        aiModel: 'gpt-5.4-mini',
      },
    })
    if (!completeRes.ok() && completeRes.status() !== 409) return null
  }

  if (!(await setLocale())) return null

  return token
}

export async function installAuthToken(page: Page, token: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('digarr-auth-token', value)
  }, token)
}

export async function installBrowserLocale(page: Page, locale: SupportedLocale) {
  await page.addInitScript((value) => {
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      get: () => value,
    })

    Object.defineProperty(window.navigator, 'languages', {
      configurable: true,
      get: () => [value, 'en-US'],
    })
  }, locale)
}
