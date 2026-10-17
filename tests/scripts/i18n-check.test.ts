// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  findAsciiMarkers,
  findCatalogIssues,
  findDashIssues,
  findDashLiterals,
  findFormalAddress,
  findHardcodedUiStrings,
} from '../../scripts/i18n-check'
import { computeSourceLock, findSourceLockDrift } from '../../scripts/i18n-source-lock'

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

  it.each([
    ['de', 'Wählen Sie Ihre Bibliothek', 'Wähle deine Bibliothek'],
    ['fr', 'Connectez votre compte', 'Connecte ton compte'],
    ['nl', 'Kies uw bibliotheek', 'Kies je bibliotheek'],
    ['ru', 'Подключите ваш аккаунт', 'Подключи свой аккаунт'],
    ['uk', 'Ви ще нічого не схвалили', 'Ти ще нічого не схвалив'],
    ['ro', 'Conectați-vă cu contul dvs.', 'Conectează-te cu contul tău.'],
  ])('flags formal address in %s and accepts the informal form', (locale, formal, informal) => {
    expect(findFormalAddress(locale, { example: formal })).toEqual([`example: "${formal}"`])
    expect(findFormalAddress(locale, { example: informal })).toEqual([])
  })

  it('flags em dashes, en dashes and double hyphens but accepts a plain hyphen', () => {
    expect(
      findDashIssues({
        a: 'Fehler \u2013 erneut',
        b: 'Failed - retry',
        c: 'Failed -- retry',
        d: '2-50 Zeichen',
      }),
    ).toEqual(['a: "Fehler \u2013 erneut"', 'c: "Failed -- retry"'])
  })
})

describe('i18n source lock', () => {
  it('reports English edits, new keys and removed keys until stamped', () => {
    const lock = computeSourceLock({ kept: 'Save', edited: 'Delete', gone: 'Old' })
    const drift = findSourceLockDrift({ kept: 'Save', edited: 'Remove', fresh: 'New' }, lock)

    expect(drift).toEqual({ changed: ['edited'], added: ['fresh'], removed: ['gone'] })
    expect(findSourceLockDrift({ kept: 'Save' }, computeSourceLock({ kept: 'Save' }))).toEqual({
      changed: [],
      added: [],
      removed: [],
    })
  })
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

describe('bare words next to JSX expressions', () => {
  it.each([
    ['pager', "<span>{start}-{end} of{' '}{total}</span>"],
    ['word after expression', '<Badge>{count} pending</Badge>'],
    ['word between expressions', '<p>{a} and {b}</p>'],
    ['multi-line text', "<p>\n  {a},{' '}\n  disambiguated, {b}\n</p>"],
  ])('flags %s', (_name, source) => {
    expect(findHardcodedUiStrings('example.tsx', source).length).toBeGreaterThan(0)
  })

  it.each([
    ['separators and numbers', '<p>{a} - {b} / {c} : ({d}) {e}% x {f} 12</p>'],
    ['catalog calls', "<p>{t('a.b')} {name}</p>"],
    ['protected terms', '<p>{count} Spotify</p>'],
    ['else branches', 'if (a) {\n  x()\n} else {\n  y()\n}'],
    ['type assertions', 'const a = b as Record<string, number>\nconst c = d as const satisfies E'],
    ['generics', 'const labels: Record<string, string> = {}'],
    ['object literals', 'const o = { a: { b: 1 }, key: { c: 2 } }'],
  ])('ignores %s', (_name, source) => {
    expect(findHardcodedUiStrings('example.tsx', source)).toEqual([])
  })

  it('flags a double hyphen between expressions', () => {
    expect(findDashLiterals('example.tsx', '<span>{start}--{end}</span>')).toEqual([
      'example.tsx:1: "--"',
    ])
  })
})

describe('findDashLiterals', () => {
  it.each([
    ["const empty = value ?? '--'", '"\'--\'"'],
    ['<p>Run — then wait</p>', '"—"'],
    ['<p>Run &mdash; then wait</p>', '"&mdash;"'],
    ['toast.error(`Failed -- retry`)', '" -- "'],
  ])('flags %s', (source, hit) => {
    expect(findDashLiterals('example.tsx', source)).toEqual([`example.tsx:1: ${hit}`])
  })

  it('ignores comments and CSS custom properties', () => {
    const source = [
      '// see the docs — not user facing',
      '/* block -- comment */',
      "const cls = 'pb-(--bottom-stack) [color:var(--accent)]'",
      "const url = 'https://example.com/a--b'",
    ].join('\n')
    expect(findDashLiterals('example.tsx', source)).toEqual([])
  })
})
