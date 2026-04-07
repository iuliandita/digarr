import { type APIRequestContext, expect, test } from '@playwright/test'

async function ensureAdminToken(request: APIRequestContext): Promise<string | null> {
  const authStatusRes = await request.get('/api/auth/status')
  if (!authStatusRes.ok()) return null
  const authStatus = (await authStatusRes.json()) as { hasUsers?: boolean }

  let token: string | null = null

  if (!authStatus.hasUsers) {
    const registerRes = await request.post('/api/auth/register', {
      data: {
        username: `e2e-admin-${Date.now()}`,
        password: 'e2e-password-123',
      },
    })
    if (!registerRes.ok()) return null
    const registerBody = (await registerRes.json()) as { token?: string }
    token = registerBody.token ?? null
  } else {
    const username = process.env.DIGARR_E2E_USERNAME
    const password = process.env.DIGARR_E2E_PASSWORD
    if (!username || !password) return null

    const loginRes = await request.post('/api/auth/login', {
      data: { username, password },
    })
    if (!loginRes.ok()) return null
    const loginBody = (await loginRes.json()) as { token?: string }
    token = loginBody.token ?? null

    if (!token) return null

    const meRes = await request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!meRes.ok()) return null
    const me = (await meRes.json()) as { isAdmin?: boolean }
    if (!me.isAdmin) return null
  }

  if (!token) return null

  const setupStatusRes = await request.get('/api/setup/status', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!setupStatusRes.ok()) return null
  const setupStatus = (await setupStatusRes.json()) as { setupComplete?: boolean }

  if (!setupStatus.setupComplete) {
    const completeRes = await request.post('/api/setup/complete', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        aiProvider: 'openai',
        aiModel: 'gpt-5.4-mini',
        listenbrainzUsername: 'e2e-listener',
      },
    })
    if (!completeRes.ok() && completeRes.status() !== 409) return null
  }

  return token
}

test.describe('library sync', () => {
  test('library sources panel renders and Sync all triggers the API request', async ({ page }) => {
    const token = await ensureAdminToken(page.request)
    test.skip(
      !token,
      'Requires a bootstrap admin user or DIGARR_E2E_USERNAME / DIGARR_E2E_PASSWORD',
    )
    if (!token) return

    await page.addInitScript((value) => {
      window.localStorage.setItem('digarr-auth-token', value)
    }, token)

    await page.goto('/library/health')
    await expect(page.getByText('Library Sources')).toBeVisible()

    const syncRequest = page.waitForRequest(
      (req) => req.url().includes('/api/library/sync') && req.method() === 'POST',
    )
    await page.getByRole('button', { name: /sync all/i }).click()
    await syncRequest
  })
})
