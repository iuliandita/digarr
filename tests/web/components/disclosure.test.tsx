// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Disclosure } from '../../../src/web/components/ui/disclosure'

describe('Disclosure', () => {
  it('keeps unsaved input while collapsed and reopened', () => {
    render(
      <Disclosure title="Advanced">
        <label>
          Cooldown
          <input defaultValue="30" />
        </label>
      </Disclosure>,
    )
    const toggle = screen.getByRole('button', { name: 'Advanced' })
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('Cooldown'), { target: { value: '42' } })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Cooldown')).not.toBeVisible()

    fireEvent.click(toggle)
    expect(screen.getByLabelText('Cooldown')).toHaveValue('42')
  })
})
