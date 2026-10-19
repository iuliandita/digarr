// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import { MoodPromptBar } from '@/web/components/mood-prompt-bar'
import { ApiError, moodDiscover, quickDiscover } from '@/web/lib/api'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

vi.mock('sonner', async () => (await import('../helpers/sonner')).sonnerMock())

vi.mock('@/web/lib/api', async () => ({
  ...(await vi.importActual<typeof import('@/web/lib/api')>('@/web/lib/api')),
  moodDiscover: vi.fn(),
  quickDiscover: vi.fn(),
}))

function renderBar() {
  return render(
    <I18nProvider>
      <MoodPromptBar existingArtistNames={new Set()} onQueued={vi.fn()} />
    </I18nProvider>,
  )
}

const PLACEHOLDER = /rainy day jazz/

describe('MoodPromptBar collapse (#993)', () => {
  it('starts collapsed and expands on click with the input focused', async () => {
    renderBar()
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Describe a mood' }))
    await waitFor(() => expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveFocus())
  })

  it('expands on the / key', async () => {
    renderBar()
    fireEvent.keyDown(window, { key: '/' })
    await waitFor(() => expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveFocus())
  })

  it('ignores / while typing in another field', () => {
    renderBar()
    const other = document.createElement('input')
    document.body.appendChild(other)
    fireEvent.keyDown(other, { key: '/' })
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull()
    other.remove()
  })

  it('collapses on blur when empty and stays open while it has text', () => {
    renderBar()
    fireEvent.keyDown(window, { key: '/' })
    const input = screen.getByPlaceholderText(PLACEHOLDER)

    fireEvent.blur(input)
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull()

    fireEvent.keyDown(window, { key: '/' })
    const reopened = screen.getByPlaceholderText(PLACEHOLDER)
    fireEvent.change(reopened, { target: { value: 'dark ambient' } })
    fireEvent.blur(reopened)
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue('dark ambient')
  })
})

describe('MoodPromptBar add errors (#1109)', () => {
  it('shows the server reason in the toast and frees the card for a retry', async () => {
    vi.mocked(moodDiscover).mockResolvedValue({
      results: [{ artistName: 'Ghost Act', reasoning: 'r', confidence: 1, genres: [] }],
    })
    vi.mocked(quickDiscover).mockRejectedValue(new ApiError(404, { title: 'Artist not found' }))
    renderBar()
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'moody' } })
    fireEvent.submit(screen.getByPlaceholderText(PLACEHOLDER).closest('form') as HTMLFormElement)

    fireEvent.click(await screen.findByRole('button', { name: '+ Discover' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to add "Ghost Act": Artist not found'),
    )
    expect(screen.getByRole('button', { name: '+ Discover' })).toBeTruthy()
  })
})
