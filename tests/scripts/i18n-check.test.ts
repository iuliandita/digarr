// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  findAsciiMarkers,
  findCatalogIssues,
  findHardcodedUiStrings,
} from '../../scripts/i18n-check'

describe('i18n check catalog quality', () => {
  it('flags untranslated english values outside the allowlist', () => {
    const issues = findCatalogIssues(
      'de',
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

  it('only applies natural-language exceptions to their locale and key', () => {
    const source = {
      'discoveryMode.option.collaboration': 'Collaboration',
    }

    expect(findCatalogIssues('fr', source, source).sameAsSource).not.toContain(
      'discoveryMode.option.collaboration',
    )
    expect(findCatalogIssues('de', source, source).sameAsSource).toContain(
      'discoveryMode.option.collaboration',
    )
  })

  it('does not treat an english control label as universal', () => {
    const source = { 'streaming.playShort': 'PLAY' }

    expect(findCatalogIssues('ja', source, source).sameAsSource).toEqual(['streaming.playShort'])
  })

  it.each([
    ['fr', 'rapproches', 'rapprochés'],
    ['pl', 'Nieprawidlowy', 'Nieprawidłowy'],
    ['tr', 'Sonsuza kadar yoksay', 'Sonsuza kadar yok say'],
    ['tr', 'MBID (UUID) yapistir', 'MBID (UUID) yapıştır'],
    ['tr', 'Album MBID (UUID)', 'Albüm MBID (UUID)'],
  ])(
    'flags ASCII-only %s catalog forms while accepting native orthography',
    (locale, bad, good) => {
      expect(findAsciiMarkers(locale, { example: bad })).toEqual([`example: "${bad}"`])
      expect(findAsciiMarkers(locale, { example: good })).toEqual([])
    },
  )
})

describe('hardcoded UI string checks', () => {
  it('flags JSX copy, translatable attributes, and toast literals', () => {
    const source = `
      export function Example() {
        toast.error('Could not save')
        return <button aria-label="Save now">Save now</button>
      }
    `

    expect(findHardcodedUiStrings('example.tsx', source)).toHaveLength(3)
  })

  it('allows catalog calls and protected product names', () => {
    const source = `
      export function Example() {
        return <><span>Spotify</span><button>{t('common.save')}</button></>
      }
    `

    expect(findHardcodedUiStrings('example.tsx', source)).toEqual([])
  })

  it('flags mixed JSX, fragments, and interpolated template literals', () => {
    const source = `
      export function Example({ name }) {
        toast.error(\`Could not save \${name}\`)
        return <><p>Hello {name}</p><p>{name} saved successfully</p><span aria-label={\`Open \${name}\`}>Value</span></>
      }
    `

    expect(findHardcodedUiStrings('example.tsx', source)).toHaveLength(5)
  })
})
