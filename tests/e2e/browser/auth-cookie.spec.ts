import { expect, type Page, test } from '@playwright/test'
import { E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME, ensureAdminToken, installAuthCookie } from './auth'

test.beforeEach(async ({ page }) => {
  const token = await ensureAdminToken(page.request, { completeSetup: true })
  expect(token).toBeTruthy()
  await page.context().clearCookies()
})

async function expectNoBrowserCredentialLeak(page: Page): Promise<void> {
  expect(page.url()).not.toContain('token=')
  expect(await page.evaluate(() => localStorage.getItem('digarr-auth-token'))).toBeNull()
}

async function expectSessionCookie(page: Page, origin?: string): Promise<void> {
  const cookies = origin ? await page.context().cookies(origin) : await page.context().cookies()
  const cookie = cookies.find((item) => item.name === 'digarr_session')
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false })
}

test('password login uses an HttpOnly cookie and no local-storage bearer', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Username').fill(E2E_ADMIN_USERNAME)
  await page.getByPlaceholder('Password').fill(E2E_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expectSessionCookie(page)
  await expectNoBrowserCredentialLeak(page)
})

test('registration uses the cookie-only browser contract', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Create account' }).click()
  const username = `browser-register-${Date.now()}-${testInfo.retry}`
  await page.getByPlaceholder('Username').fill(username)
  await page.getByPlaceholder('Password (min 12 characters)').fill('registration-password-123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expectSessionCookie(page)
  await expectNoBrowserCredentialLeak(page)
})

test('rotates an old stored bearer and rejects replay', async ({ page }) => {
  const oldToken = await ensureAdminToken(page.request, { completeSetup: true })
  expect(oldToken).toBeTruthy()
  if (!oldToken) return
  await page.addInitScript((token) => {
    localStorage.setItem('digarr-auth-token', token)
  }, oldToken)

  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expectSessionCookie(page)

  const replay = await page.request.get('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${oldToken}` },
  })
  expect(replay.status()).toBe(401)
  await expectNoBrowserCredentialLeak(page)
})

test('logout revokes the cookie session and returns to login', async ({ page }) => {
  await installAuthCookie(page)
  await page.goto('/')
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Digarr-CSRF': '1' },
    })
    return response.status
  })
  expect(status).toBe(204)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  expect((await page.context().cookies()).some((item) => item.name === 'digarr_session')).toBe(
    false,
  )
  const authStatus = await page.request.get('/api/v1/auth/status')
  expect(await authStatus.json()).toMatchObject({ authenticated: false })
  await expectNoBrowserCredentialLeak(page)
})

test('password change invalidates old bearer sessions and keeps a fresh cookie', async ({
  page,
}) => {
  const oldBearer = await ensureAdminToken(page.request, { completeSetup: true })
  expect(oldBearer).toBeTruthy()
  if (!oldBearer) return
  await installAuthCookie(page)
  await page.goto('/settings?tab=account')

  const temporaryPassword = 'e2e-password-456'
  let changed = false
  try {
    await page.locator('#current-pw').fill(E2E_ADMIN_PASSWORD)
    await page.locator('#new-pw').fill(temporaryPassword)
    await page.locator('#confirm-pw').fill(temporaryPassword)
    const [changeResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/change-password') &&
          response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Change password' }).click(),
    ])
    changed = changeResponse.status() === 204
    expect(changeResponse.status()).toBe(204)
    await expect(page.getByText('Password changed')).toBeVisible()

    const replay = await page.request.get('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${oldBearer}` },
    })
    expect(replay.status()).toBe(401)
    await expectSessionCookie(page)
    await expectNoBrowserCredentialLeak(page)
  } finally {
    if (changed) {
      const restoreStatus = await page.evaluate(
        async ([currentPassword, newPassword]) => {
          const response = await fetch('/api/v1/auth/change-password', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Digarr-CSRF': '1' },
            body: JSON.stringify({ currentPassword, newPassword }),
          })
          return response.status
        },
        [temporaryPassword, E2E_ADMIN_PASSWORD],
      )
      expect(restoreStatus).toBe(204)
    }
  }
})

test('completes the full OIDC redirect flow and clears the transaction cookie', async ({
  page,
}) => {
  // Start at login: the route sets the digarr_oidc_<state> transaction cookie,
  // redirects to the mock provider, which bounces back to the real callback
  // route. The callback reads the binding from the cookie, issues a session,
  // and clears the transaction cookie.
  await page.goto('http://127.0.0.1:3011/api/v1/auth/oidc/login')
  await expect(page.getByText('OIDC callback complete')).toBeVisible()
  expect(page.url()).toBe('http://127.0.0.1:3011/')
  await expectSessionCookie(page, 'http://127.0.0.1:3011')

  // No URL arg: return every cookie in the context regardless of path. A
  // path-scoped query (the callback cookie lives at /api/v1/auth/oidc/callback)
  // would never match a `/` lookup, making the assertion vacuous.
  const allCookies = await page.context().cookies()
  expect(allCookies.some((item) => item.name.startsWith('digarr_oidc_'))).toBe(false)
  await expectNoBrowserCredentialLeak(page)
})

test('proxy auth uses CSRF and upstream logout semantics', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'X-Forwarded-User': 'proxy-e2e-user' })
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expectSessionCookie(page)

  const patchStatus = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/me/locale', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Digarr-CSRF': '1' },
      body: JSON.stringify({ preferredLocale: 'en' }),
    })
    return response.status
  })
  expect(patchStatus).toBe(200)

  const logoutStatus = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Digarr-CSRF': '1' },
    })
    return response.status
  })
  expect(logoutStatus).toBe(204)
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/status', { credentials: 'same-origin' })
    return response.json() as Promise<{ authenticated: boolean }>
  })
  expect(status).toMatchObject({ authenticated: true })
  await expectSessionCookie(page)
  await expectNoBrowserCredentialLeak(page)
})

test('rejects a same-site cross-origin form mutation', async ({ page }) => {
  await installAuthCookie(page)
  await page.goto('/')
  await page.setContent(`
    <form method="post" action="http://localhost:3000/api/v1/auth/logout">
      <button type="submit">attack</button>
    </form>
  `)
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url() === 'http://localhost:3000/api/v1/auth/logout'),
    page.getByRole('button', { name: 'attack' }).click(),
  ])
  expect(response.status()).toBe(403)

  await page.goto('http://localhost:5173/')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expectNoBrowserCredentialLeak(page)
})

test('service-worker reload keeps cookie auth and never caches API responses', async ({ page }) => {
  await installAuthCookie(page)
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  const cachedApiUrls = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        if (request.url.includes('/api/')) urls.push(request.url)
      }
    }
    return urls
  })
  expect(cachedApiUrls).toEqual([])
  await expectNoBrowserCredentialLeak(page)
})

test('does not turn a retired OIDC fragment into a browser credential', async ({ page }) => {
  await page.goto('/#oidc_token=retired-value')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  expect((await page.context().cookies()).some((item) => item.name === 'digarr_session')).toBe(
    false,
  )
  await expectNoBrowserCredentialLeak(page)
})
