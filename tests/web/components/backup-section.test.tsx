// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupSection } from '@/web/components/admin/backup-section'
import { ApiError, getLastAutoBackup, restoreBackupApi } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'
import { loadMessages } from '@/web/lib/locale-catalogs'
import { createTestQueryClient } from '../helpers/query'
import { installMemoryLocalStorage } from '../helpers/storage'

vi.mock('@/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/web/lib/api')>()),
  getLastAutoBackup: vi.fn(),
  restoreBackupApi: vi.fn(),
}))

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

const restored = {
  tablesRestored: { users: 2, settings: 1 },
  warnings: ['Some cached data was skipped'],
  encryptionMismatch: false,
  affectedEncryptedFields: [],
}

function setup() {
  const client = createTestQueryClient()
  const view = render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <BackupSection />
      </QueryClientProvider>
    </I18nProvider>,
  )
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('Missing backup file selector')
  const file = new File(['{}'], 'backup.json', { type: 'application/json' })
  const select = () => fireEvent.change(input, { target: { files: [file] } })
  return { input, file, select }
}

function confirmRestore() {
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Restore from Backup' }))
}

describe('BackupSection restore confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLastAutoBackup).mockResolvedValue({ lastAutoBackup: null })
    vi.mocked(restoreBackupApi).mockResolvedValue(restored)
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: vi.fn(() => 'en'), setItem: vi.fn() },
    })
  })

  it.each(['cancel', 'Escape'])(
    'discards selection on %s without uploading and allows the same file again',
    async (action) => {
      const { input, select } = setup()
      select()

      expect(restoreBackupApi).not.toHaveBeenCalled()
      const dialog = screen.getByRole('dialog', { name: 'Restore backup?' })
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
      )
      if (action === 'cancel') {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      } else {
        fireEvent.keyDown(dialog, { key: 'Escape' })
      }

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(restoreBackupApi).not.toHaveBeenCalled()
      expect(input.value).toBe('')
      select()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(restoreBackupApi).not.toHaveBeenCalled()
    },
  )

  it('uploads once after consent, blocks duplicate submissions, and preserves the summary and warnings', async () => {
    let finish: (result: typeof restored) => void = () => undefined
    vi.mocked(restoreBackupApi).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { input, file, select } = setup()
    select()
    expect(restoreBackupApi).not.toHaveBeenCalled()
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Restore from Backup',
    })
    act(() => {
      confirm.click()
      confirm.click()
    })

    expect(restoreBackupApi).toHaveBeenCalledExactlyOnceWith(file, false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restoring...' })).toBeDisabled()
    expect(input).toBeDisabled()
    select()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => finish(restored))

    expect(toast.success).toHaveBeenCalledWith('Restored 3 rows across 2 tables')
    expect(toast.warning).toHaveBeenCalledWith('Some cached data was skipped')
    expect(screen.getByRole('button', { name: 'Restore from Backup' })).not.toBeDisabled()
    expect(input.value).toBe('')
  })

  it.each([
    ['response', 'cancel'],
    ['response', 'accept'],
    ['409', 'cancel'],
    ['409', 'accept'],
  ])('requires separate mismatch consent for %s and handles %s', async (source, action) => {
    if (source === '409') {
      vi.mocked(restoreBackupApi).mockRejectedValueOnce(
        new ApiError(409, {
          error: 'Encryption key mismatch',
          affectedFields: ['settings.apiKey'],
        }),
      )
    } else {
      vi.mocked(restoreBackupApi).mockResolvedValueOnce({
        ...restored,
        encryptionMismatch: true,
        affectedEncryptedFields: ['settings.apiKey'],
      })
    }
    const { file, select } = setup()
    select()
    confirmRestore()
    const dialog = await screen.findByRole('dialog', { name: 'Encryption key mismatch' })
    expect(restoreBackupApi).toHaveBeenCalledExactlyOnceWith(file, false)
    expect(within(dialog).getByText(/settings.apiKey/)).toBeInTheDocument()
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    )

    fireEvent.click(
      within(dialog).getByRole('button', {
        name: action === 'cancel' ? 'Cancel' : 'Restore Anyway',
      }),
    )
    if (action === 'accept') {
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          'Restored 3 rows. Re-enter credentials for encrypted fields.',
        ),
      )
      expect(restoreBackupApi).toHaveBeenNthCalledWith(2, file, true)
      expect(restoreBackupApi).toHaveBeenCalledTimes(2)
    } else {
      expect(restoreBackupApi).toHaveBeenCalledTimes(1)
      expect(toast.success).not.toHaveBeenCalled()
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['normal', 'conflict', 'forced'])(
    'reports %s failure without an automatic forced retry',
    async (mode) => {
      const failure =
        mode === 'conflict'
          ? new ApiError(409, { error: 'Another operation is running' })
          : new Error('Restore failed')
      if (mode === 'forced') {
        vi.mocked(restoreBackupApi).mockResolvedValueOnce({ ...restored, encryptionMismatch: true })
      }
      vi.mocked(restoreBackupApi).mockRejectedValueOnce(failure)
      const { select } = setup()
      select()
      confirmRestore()
      if (mode === 'forced') {
        const dialog = await screen.findByRole('dialog', { name: 'Encryption key mismatch' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Restore Anyway' }))
      }

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to restore backup'))
      expect(restoreBackupApi).toHaveBeenCalledTimes(mode === 'forced' ? 2 : 1)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(toast.success).not.toHaveBeenCalled()
    },
  )

  it('formats the last auto backup timestamp with the active locale', async () => {
    installMemoryLocalStorage({ 'digarr-locale': 'fr' })
    await loadMessages('fr')
    vi.mocked(getLastAutoBackup).mockResolvedValue({
      lastAutoBackup: { filename: 'auto.json', createdAt: '2025-12-31T14:05:00.000Z' },
    })

    setup()

    expect(await screen.findByText(/Dernière sauvegarde auto/)).toHaveTextContent(
      `Dernière sauvegarde auto : ${new Date('2025-12-31T14:05:00.000Z').toLocaleString('fr')}`,
    )
  })
})
