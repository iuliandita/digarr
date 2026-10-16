// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  applyCatalogUpdates,
  buildChatCompletionsUrl,
  buildTranslationMessages,
  findStaleSourceKeys,
  validateTranslatedCatalog,
} from '../../scripts/i18n-machine-translate'
import { computeSourceLock } from '../../scripts/i18n-source-lock'

describe('i18n machine translation helpers', () => {
  it('passes real source strings to the model without escaping them', () => {
    const artistPlaceholder = `${'${'}artist}`
    const messages = buildTranslationMessages('en', 'fr', {
      sample: `Keep ${artistPlaceholder} in \`code\` form.\nSecond line.`,
    })

    expect(messages[1]?.content).toContain(`Keep ${artistPlaceholder} in \`code\` form.`)
    expect(messages[1]?.content).toContain('\\nSecond line.')
    expect(messages[1]?.content).not.toContain(`\\${artistPlaceholder}`)
    expect(messages[1]?.content).not.toContain('\\`code\\`')
  })

  it('rejects placeholder and line-break drift', () => {
    const namePlaceholder = `${'${'}name}`
    const usernamePlaceholder = `${'${'}username}`
    expect(() =>
      validateTranslatedCatalog(
        {
          sample: `Hello ${namePlaceholder}\nLine two`,
        },
        {
          sample: `Bonjour ${usernamePlaceholder} Line two`,
        },
      ),
    ).toThrow(/placeholder|line break/i)
  })

  it('allows numbered placeholders to move for target-language grammar', () => {
    expect(() =>
      validateTranslatedCatalog({ sample: '{0} of {1}' }, { sample: '{1} 中的 {0}' }),
    ).not.toThrow()
  })

  it('rejects protected brand-term drift', () => {
    expect(() =>
      validateTranslatedCatalog(
        {
          sample: 'Digarr syncs with Lidarr and OpenAI-compatible services.',
        },
        {
          sample: 'Digar syncs with Lidarr and compatible AI services.',
        },
      ),
    ).toThrow(/protected term/i)
  })

  it('rejects protected protocol and metadata-provider drift', () => {
    expect(() =>
      validateTranslatedCatalog(
        { sample: 'TheAudioDB returns JSON metadata.' },
        { sample: 'AudioDB returns JSÖN metadata.' },
      ),
    ).toThrow(/protected term/i)
  })

  it('accepts OpenAI-style base urls with or without /v1', () => {
    expect(buildChatCompletionsUrl('https://api.openai.com')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
    expect(buildChatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
    expect(buildChatCompletionsUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
  })

  it('picks only keys whose English changed or is new since the stamp', () => {
    const lock = computeSourceLock({ same: 'Save', edited: 'Delete' })
    expect(findStaleSourceKeys({ same: 'Save', edited: 'Remove', fresh: 'New' }, lock)).toEqual([
      'edited',
      'fresh',
    ])
  })

  it('shows the previous translation so updates keep their terminology', () => {
    const messages = buildTranslationMessages('en', 'de', { a: 'Remove' }, { a: 'Löschen' })
    expect(messages[1]?.content).toContain('"a": "Löschen"')
    expect(messages[0]?.content).toMatch(/informally/)
  })

  it('rewrites changed entries in place and inserts new keys in English order', () => {
    const file = [
      'export const de = {',
      "  'a': 'Alt',",
      "  'b':",
      "    'Zweite Zeile',",
      "  'd': 'Vier',",
      '} as const',
      '',
    ].join('\n')
    const updated = applyCatalogUpdates(file, { b: "Neu's", c: 'Drei' }, ['a', 'b', 'c', 'd'])
    expect(updated.split('\n')).toEqual([
      'export const de = {',
      "  'a': 'Alt',",
      `  'b': "Neu's",`,
      "  'c': 'Drei',",
      "  'd': 'Vier',",
      '} as const',
      '',
    ])
  })
})
