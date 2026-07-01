import type { SupportedLocale } from '@/core/i18n/locales'
import type { MessageCatalog } from '@/core/i18n/messages/types'
import { deOverrides } from './de'
import { esOverrides } from './es'
import { frOverrides } from './fr'
import { itOverrides } from './it'
import { jaOverrides } from './ja'
import { koOverrides } from './ko'
import { nlOverrides } from './nl'
import { plOverrides } from './pl'
import { ptBROverrides } from './pt-BR'
import { roOverrides } from './ro'
import { ruOverrides } from './ru'
import { trOverrides } from './tr'
import { ukOverrides } from './uk'
import { zhCNOverrides } from './zh-CN'

export const MESSAGE_OVERRIDES: Partial<Record<SupportedLocale, Partial<MessageCatalog>>> = {
  es: esOverrides,
  fr: frOverrides,
  de: deOverrides,
  it: itOverrides,
  nl: nlOverrides,
  ro: roOverrides,
  tr: trOverrides,
  uk: ukOverrides,
  pl: plOverrides,
  ja: jaOverrides,
  'pt-BR': ptBROverrides,
  ru: ruOverrides,
  ko: koOverrides,
  'zh-CN': zhCNOverrides,
}
