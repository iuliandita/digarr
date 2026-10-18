// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiTokensSection } from '@/web/components/api-tokens-section'
import { createApiToken, listApiTokens, revokeApiToken } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/api', () => ({
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const token = {
  id: 1,
  name: 'nightly',
  prefix: 'dga_abcd',
  scope: 'read' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
}
const secret = `dga_${'x'.repeat(43)}`
const writeText = vi.fn().mockResolvedValue(undefined)

function setup(isAdmin = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiTokensSection isAdmin={isAdmin} />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listApiTokens).mockResolvedValue([token])
  vi.mocked(createApiToken).mockResolvedValue({ ...token, token: secret })
  vi.mocked(revokeApiToken).mockResolvedValue(undefined)
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'en', setItem: vi.fn() },
  })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})

describe('Account API tokens', () => {
  it.each([false, true])('creates and reveals a token once with admin=%s', async (isAdmin) => {
    setup(isAdmin)
    await screen.findByText('nightly')
    expect(screen.getByText('dga_abcd...')).toBeTruthy()
    expect(screen.getAllByText('Never')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Create API token' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('option', { name: 'Admin access' }) !== null).toBe(isAdmin)
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'backup' } })
    fireEvent.change(within(dialog).getByLabelText('Scope'), {
      target: { value: isAdmin ? 'admin' : 'write' },
    })
    fireEvent.change(within(dialog).getByLabelText('Expires'), { target: { value: '90' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Create$/ }))
    await waitFor(() =>
      expect(createApiToken).toHaveBeenCalledWith({
        name: 'backup',
        scope: isAdmin ? 'admin' : 'write',
        expiresInDays: 90,
      }),
    )
    const reveal = (await within(dialog).findByLabelText('API tokens')) as HTMLInputElement
    expect(reveal.value).toBe(secret)
    expect(within(dialog).getByRole('status').textContent).toContain('cannot see it again')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy token' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(secret))
    const config = within(dialog).getByLabelText('MCP client configuration').textContent ?? ''
    expect(JSON.parse(config)).toEqual({
      mcpServers: {
        digarr: {
          type: 'http',
          url: `${window.location.origin}/api/v1/mcp`,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy configuration' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(config))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByDisplayValue(secret)).toBeNull()
    expect(screen.queryByLabelText('MCP client configuration')).toBeNull()
    expect(screen.queryByText(config)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create API token' }))
    expect(screen.queryByDisplayValue(secret)).toBeNull()
    expect(screen.queryByLabelText('MCP client configuration')).toBeNull()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('')
  })

  it.each([false, true])('revokes only after confirmation=%s', async (confirm) => {
    setup()
    await screen.findByText('nightly')
    fireEvent.click(screen.getByRole('button', { name: 'Revoke token' }))
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText('Revoke "nightly"? Scripts using it will lose access immediately.'),
    ).toBeTruthy()
    expect(revokeApiToken).not.toHaveBeenCalled()
    fireEvent.click(
      within(dialog).getByRole('button', { name: confirm ? 'Revoke token' : 'Cancel' }),
    )
    if (confirm) await waitFor(() => expect(revokeApiToken).toHaveBeenCalledWith(1))
    else expect(revokeApiToken).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
