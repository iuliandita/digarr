// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/web/components/error-boundary'
import { I18nProvider } from '@/web/lib/i18n'

vi.mock('@/web/lib/locale-storage', async () =>
  (await import('../helpers/locale')).localeStorageMock(),
)

function withI18n(node: ReactNode) {
  return <I18nProvider>{node}</I18nProvider>
}

function Boom({ message }: { message: string }): null {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  const originalError = console.error
  beforeEach(() => {
    // React logs caught render errors to console.error — silence to keep
    // test output readable.
    console.error = vi.fn()
  })
  afterEach(() => {
    console.error = originalError
  })

  it('renders children when no error is thrown', () => {
    render(
      withI18n(
        <ErrorBoundary>
          <p>healthy child</p>
        </ErrorBoundary>,
      ),
    )
    expect(screen.getByText('healthy child')).toBeInTheDocument()
  })

  it('shows friendly copy with the raw message tucked into a details disclosure', () => {
    render(withI18n(<ErrorBoundary>{(<Boom message="kaboom" />) as ReactNode}</ErrorBoundary>))
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/kaboom/)).not.toBeVisible()
    fireEvent.click(toggle)
    expect(screen.getByText(/kaboom/)).toBeVisible()
  })

  it('exposes reload and home buttons in the fallback', () => {
    render(withI18n(<ErrorBoundary>{(<Boom message="x" />) as ReactNode}</ErrorBoundary>))
    const buttons = screen.getAllByRole('button')
    // Reload + Home + Details = 3 buttons in the fallback UI.
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: 'Go home' })).toBeInTheDocument()
  })
})
