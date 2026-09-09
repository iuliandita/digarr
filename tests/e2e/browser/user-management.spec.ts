import { expect, test } from '@playwright/test'
import { E2E_ADMIN_PASSWORD, E2E_ADMIN_USERNAME, ensureAdminToken } from './auth'
import { seedRecommendations } from './seed'

test('promotes users, assigns a target, and deletes a user with recommendations', async ({
  page,
}) => {
  const token = await ensureAdminToken(page.request, { completeSetup: true })
  expect(token).toBeTruthy()
  const headers = { Authorization: `Bearer ${token}` }
  const username = `listener-${Date.now()}`
  const password = 'listener-password-123'
  const created = await page.request.post('/api/v1/users', {
    headers,
    data: { username, password },
  })
  expect(created.status()).toBe(201)
  const user = (await created.json()) as { id: number }

  const promoted = await page.request.patch(`/api/v1/users/${user.id}`, {
    headers,
    data: { isAdmin: true },
  })
  expect(promoted.status()).toBe(204)
  const afterPromotion = await page.request.get('/api/v1/users', { headers })
  expect(await afterPromotion.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: user.id, isAdmin: true })]),
  )
  const demoted = await page.request.patch(`/api/v1/users/${user.id}`, {
    headers,
    data: { isAdmin: false },
  })
  expect(demoted.status()).toBe(204)
  const afterDemotion = await page.request.get('/api/v1/users', { headers })
  expect(await afterDemotion.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: user.id, isAdmin: false })]),
  )

  const login = await page.request.post('/api/v1/auth/login', { data: { username, password } })
  expect(login.ok()).toBeTruthy()
  const { token: userToken } = (await login.json()) as { token: string }
  await seedRecommendations(page.request, userToken)

  await page.goto('/settings')
  await page.getByPlaceholder('Username').fill(E2E_ADMIN_USERNAME)
  await page.getByPlaceholder('Password').fill(E2E_ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Targets', exact: true }).click()
  await page.getByRole('button', { name: 'Add Target', exact: true }).click()
  await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('lidarr')
  await page
    .getByRole('combobox', { name: 'Assigned user', exact: true })
    .selectOption(String(user.id))
  await page.getByLabel('Name', { exact: true }).fill('Listener destination')
  await page.getByLabel('URL', { exact: true }).fill('http://lidarr:8686')
  await page.getByLabel('API Key', { exact: true }).fill('test-target-key')
  await page.getByRole('button', { name: 'Add Target', exact: true }).click()
  await expect(page.getByText('Target added', { exact: true })).toBeVisible()

  const targetsResponse = await page.request.get('/api/v1/targets', {
    headers: { Authorization: `Bearer ${userToken}` },
  })
  expect(targetsResponse.ok()).toBeTruthy()
  const targets = (await targetsResponse.json()) as Array<{
    userId: number
    owned: boolean
    config: { apiKey: string }
  }>
  expect(targets).toHaveLength(1)
  expect(targets[0]).toMatchObject({ userId: user.id, owned: true, config: { apiKey: '***' } })

  const deleted = await page.request.delete(`/api/v1/users/${user.id}`, { headers })
  expect(deleted.status()).toBe(204)
  const remaining = await page.request.get('/api/v1/users', { headers })
  expect(
    ((await remaining.json()) as Array<{ id: number }>).some((entry) => entry.id === user.id),
  ).toBe(false)
})
