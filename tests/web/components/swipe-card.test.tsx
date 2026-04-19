// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SwipeCard } from '@/web/components/swipe-card'

describe('SwipeCard', () => {
  it('renders children unchanged', () => {
    render(
      <SwipeCard onSwipeLeft={vi.fn()} onSwipeRight={vi.fn()}>
        <p>card body</p>
      </SwipeCard>,
    )
    expect(screen.getByText('card body')).toBeInTheDocument()
  })

  it('renders children when swipe is disabled', () => {
    render(
      <SwipeCard enabled={false} onSwipeLeft={vi.fn()} onSwipeRight={vi.fn()}>
        <p>static card</p>
      </SwipeCard>,
    )
    expect(screen.getByText('static card')).toBeInTheDocument()
  })

  it('does not invoke swipe callbacks on initial render', () => {
    const onSwipeLeft = vi.fn()
    const onSwipeRight = vi.fn()
    render(
      <SwipeCard onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight}>
        <p>idle</p>
      </SwipeCard>,
    )
    expect(onSwipeLeft).not.toHaveBeenCalled()
    expect(onSwipeRight).not.toHaveBeenCalled()
  })
})
