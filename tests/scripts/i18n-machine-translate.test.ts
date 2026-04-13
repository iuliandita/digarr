// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  buildChatCompletionsUrl,
  buildTranslationMessages,
  validateTranslatedCatalog,
} from '../../scripts/i18n-machine-translate'

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
})
