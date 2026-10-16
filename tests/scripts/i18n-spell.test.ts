// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { loadAllowlist, parseHunspellPipe, prepareForSpellCheck } from '../../scripts/i18n-spell'

describe('i18n spell check helpers', () => {
  it('drops placeholders, URLs, acronyms, product names and dangling hyphens', () => {
    expect(
      prepareForSpellCheck(
        'Öffne {0} in Lidarr - siehe https://example.com/x und den API-Schlüssel',
      ),
    ).toBe('Öffne in siehe und den Schlüssel')
  })

  it('maps each misspelling back to its input line', () => {
    const output = [
      '@(#) International Ispell Version 3.2.06 (but really Hunspell 1.7.2)',
      '*',
      '& Bibliotheque 1 0: Bibliothèque',
      '',
      '*',
      '*',
      '',
      '# donnees 4',
      '',
    ].join('\n')
    expect(parseHunspellPipe(output, 3)).toEqual([['Bibliotheque'], [], ['donnees']])
  })

  it('reads allowlist words and ignores comments and blank lines', () => {
    expect([...loadAllowlist('# products\nPlaylist\n\nToken  # loanword\n')]).toEqual([
      'Playlist',
      'Token',
    ])
  })
})
