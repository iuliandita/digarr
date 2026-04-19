// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  getStoredToken: vi.fn(),
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  setStoredToken: vi.fn(),
}))

vi.mock('@/web/lib/api', () => ({
  AUTH_EXPIRED_EVENT: 'digarr:auth-expired',
  clearStoredToken: apiMocks.clearStoredToken,
  getAuthStatus: apiMocks.getAuthStatus,
  getStoredToken: apiMocks.getStoredToken,
  loginUser: apiMocks.loginUser,
  registerUser: apiMocks.registerUser,
  setStoredToken: apiMocks.setStoredToken,
}))

import { AuthGate } from '@/web/components/auth-gate'

describe('AuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.getAuthStatus.mockResolvedValue({
      required: true,
      hasUsers: true,
      oidcEnabled: false,
      version: '0.24.2',
    })
    apiMocks.getStoredToken.mockReturnValue('stored-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 1, username: 'test' }), { status: 200 })),
    )
  })

  it('verifies stored tokens against /api/auth/me before authenticating', async () => {
    render(
      <I18nProvider>
        <AuthGate>
          <div>secret area</div>
        </AuthGate>
      </I18nProvider>,
    )

    await screen.findByText('secret area')

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/validate',
      expect.objectContaining({
        headers: { Authorization: 'Bearer stored-token' },
      }),
    )
  })

  it('clears invalid stored tokens and shows the login form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    )

    render(
      <I18nProvider>
        <AuthGate>
          <div>secret area</div>
        </AuthGate>
      </I18nProvider>,
    )

    await waitFor(() => {
      expect(apiMocks.clearStoredToken).toHaveBeenCalled()
    })
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByText('secret area')).not.toBeInTheDocument()
  })
})
