import type { SupportedLocale } from '@/core/i18n/locales'
import type { MessageCatalog } from '@/core/i18n/messages/types'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { it } from './it'
import { ja } from './ja'
import { ko } from './ko'
import { nl } from './nl'
import { MESSAGE_OVERRIDES } from './overrides'
import { pl } from './pl'
import { ptBR } from './pt-BR'
import { ro } from './ro'
import { ru } from './ru'
import { tr } from './tr'
import { uk } from './uk'
import { zhCN } from './zh-CN'

const LOCALE_MESSAGES: Record<SupportedLocale, Partial<MessageCatalog>> = {
  en,
  es,
  fr,
  de,
  'pt-BR': ptBR,
  it,
  nl,
  ro,
  pl,
  tr,
  uk,
  ru,
  ja,
  ko,
  'zh-CN': zhCN,
}

export function getRawMessages(locale: SupportedLocale): Partial<MessageCatalog> {
  return LOCALE_MESSAGES[locale]
}

export function getAuthoredMessages(locale: SupportedLocale): Partial<MessageCatalog> {
  if (locale === 'en') return en

  return {
    ...LOCALE_MESSAGES[locale],
    ...(MESSAGE_OVERRIDES[locale] ?? {}),
  }
}

export function getMessages(locale: SupportedLocale): MessageCatalog {
  if (locale === 'en') return en

  return {
    ...en,
    ...getAuthoredMessages(locale),
  }
}
