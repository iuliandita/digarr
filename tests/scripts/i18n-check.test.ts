// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { findCatalogIssues } from '../../scripts/i18n-check'

describe('i18n check catalog quality', () => {
  it('flags untranslated english values outside the allowlist', () => {
    const issues = findCatalogIssues(
      {
        foo: 'Save changes',
        brand: 'Spotify',
      },
      {
        foo: 'Save changes',
        brand: 'Spotify',
      },
    )

    expect(issues.sameAsSource).toContain('foo')
    expect(issues.sameAsSource).not.toContain('brand')
  })
})
