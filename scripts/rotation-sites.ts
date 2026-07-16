import {
  SENSITIVE_OAUTH,
  SENSITIVE_PREFERENCES,
  SENSITIVE_SETTINGS,
  SENSITIVE_USER_CONNECTIONS,
} from '../src/core/crypto'

export type RotationSite = { table: string; column: string }

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function scalarSites(table: string, fields: readonly string[]): RotationSite[] {
  return fields.map((field) => ({ table, column: snakeCase(field) }))
}

export const COLUMN_SITES: RotationSite[] = [
  ...scalarSites('settings', SENSITIVE_SETTINGS),
  ...scalarSites('users', SENSITIVE_USER_CONNECTIONS),
  ...scalarSites('oauth_tokens', SENSITIVE_OAUTH),
]

export const NESTED_SITES = SENSITIVE_PREFERENCES.map((key) => ({
  table: 'settings',
  column: 'preferences',
  path: [key],
}))
