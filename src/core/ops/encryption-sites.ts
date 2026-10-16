import {
  SENSITIVE_OAUTH,
  SENSITIVE_PREFERENCES,
  SENSITIVE_SETTINGS,
  SENSITIVE_USER_CONNECTIONS,
} from '@/core/crypto'

export type EncryptedColumnSite = { table: string; column: string }
export type EncryptedNestedSite = EncryptedColumnSite & { path: string[] }

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function scalarSites(table: string, fields: readonly string[]): EncryptedColumnSite[] {
  return fields.map((field) => ({ table, column: snakeCase(field) }))
}

export const COLUMN_SITES: EncryptedColumnSite[] = [
  ...scalarSites('settings', SENSITIVE_SETTINGS),
  ...scalarSites('users', SENSITIVE_USER_CONNECTIONS),
  ...scalarSites('oauth_tokens', SENSITIVE_OAUTH),
]

export const NESTED_SITES: EncryptedNestedSite[] = ['settings', 'users'].flatMap((table) =>
  SENSITIVE_PREFERENCES.map((key) => ({
    table,
    column: 'preferences',
    path: [key],
  })),
)
