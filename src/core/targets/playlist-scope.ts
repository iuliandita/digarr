import { createHash } from 'node:crypto'
import type { TargetType } from './types'

export function playlistEndpoint(url: string): string {
  return new URL(url).toString().replace(/\/+$/, '')
}

export function createPlaylistScope(type: TargetType, fields: string[]): string {
  if (fields.some((field) => typeof field !== 'string' || !field.trim())) {
    throw new Error('Playlist destination identity is incomplete')
  }
  return `v1:${createHash('sha256')
    .update(JSON.stringify([type, ...fields]))
    .digest('hex')}`
}
