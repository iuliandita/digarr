import type { SupportedLocale } from './locales'
import { getMessages } from './messages'
import type { MessageKey } from './messages/types'

export type Translator = (key: MessageKey, ...args: string[]) => string

/**
 * Build a server-side translator for the given locale. Interpolates positional
 * `{0}`, `{1}`, ... placeholders. Falls back to the source-locale message and
 * then the key itself, never throws on a missing entry.
 */
export function createTranslator(locale: SupportedLocale | undefined): Translator {
  const messages = getMessages(locale ?? 'en')
  return (key, ...args) => {
    const template = messages[key] ?? key
    return args.length === 0
      ? template
      : template.replace(/\{(\d+)\}/g, (_, idx) => args[Number(idx)] ?? '')
  }
}
