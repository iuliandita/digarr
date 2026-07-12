import type { en } from './en'

export type MessageKey = keyof typeof en
export type MessageCatalog = { [Key in MessageKey]: string }
