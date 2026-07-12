// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SENSITIVE_OAUTH,
  SENSITIVE_OIDC,
  SENSITIVE_SETTINGS,
  SENSITIVE_USER_CONNECTIONS,
} from '../../src/core/crypto'

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

describe('encryption-key rotation coverage', () => {
  it('covers every encrypted scalar column', () => {
    const source = readFileSync(
      new URL('../../scripts/rotate-encryption-key.ts', import.meta.url),
      'utf8',
    )
    const block = source.match(/const COLUMN_SITES: Site\[\] = \[([\s\S]*?)\n\]/)?.[1] ?? ''
    const actual = [...block.matchAll(/\{ table: '([^']+)', column: '([^']+)' \}/g)]
      .map((match) => `${match[1]}.${match[2]}`)
      .sort()
    const expected = [
      ...SENSITIVE_SETTINGS.map((column) => `settings.${snakeCase(column)}`),
      ...SENSITIVE_USER_CONNECTIONS.map((column) => `users.${snakeCase(column)}`),
      ...SENSITIVE_OAUTH.map((column) => `oauth_tokens.${snakeCase(column)}`),
      ...SENSITIVE_OIDC.map((column) => `oidc_tokens.${snakeCase(column)}`),
    ].sort()

    expect(actual).toEqual(expected)
  })
})
