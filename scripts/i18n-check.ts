#!/usr/bin/env bun

/**
 * Validate that every supported locale exports a complete message catalog.
 *
 * Usage: bun scripts/i18n-check.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTIST_EXTERNAL_LINK_KEYS } from '../src/core/artists/external-links'
import { createDefaultDiscoveryModeRegistry } from '../src/core/discovery-modes/registry'
import { SUPPORTED_LOCALES } from '../src/core/i18n/locales'
import { getMessages, getRawMessages } from '../src/core/i18n/messages'
import { PROTECTED_I18N_TERMS } from '../src/core/i18n/protected-terms'
import { REJECTION_REASONS } from '../src/core/recommendations/rejection-reasons'
import { collectDiscoveryMessageKeys } from '../src/web/lib/discovery-i18n'
import { validateTranslatedCatalog } from './i18n-machine-translate'
import { findSourceLockDrift, readSourceLock } from './i18n-source-lock'

// Markers that indicate stripped diacritics in the accented-language catalogs.
// CI fails on any match so we cannot regress to ASCII-substituted spellings.
// Tokens are chosen to be unambiguous stripped forms (the un-accented spelling
// is not itself a valid word in that language), so there are no false matches.
const ASCII_MARKERS: Record<string, RegExp> = {
  de: /\b(Zurueck|Taeglich|Laedt|Hoerverlauf|Durchlaeufe|Kuenstler|Aehnliche|Veroeffentlichungen|Wochentliche)\b/,
  es: /\b(Configuracion|Ultima|automatica|busqueda|suscripcion|Genero|puntuacion|posicion|comenzara|ejecucion)\b/,
  fr: /\b(demarrera|rapproches)\b/,
  it: /\b(partira)\b/,
  'pt-BR': /\b(posicao|comecara|execucao)\b/,
  ro: /\b(pozitia|incepe|dupa|curenta|Daca|tau|ruleaza|Testeaza|restrange)\b/,
  pl: /\b(sie|zakonczeniu|biezacego|zobacza|logowac|dostawce|feedow|najczesciej|sluchanego|gleboko|uzytkownikow|tagow|pasujacych|wydanicze|powiazane|sledzionymi|Siec|podobienstwa|wspolpracownikow|sasiednie|wytwornii|odsluchu|wydan|Odwaznosc|probkowania|wyrazenie|Popularnosc|celow|kazdym|Dziala|Wlacz|przyszle|sledzenie|istniejacych|sluchania|Wyzsze|wartosci|znajduja|Nizsze|Wspolczynnik|Zdjecia|pochodza|pelnia|uzyc|kierujac|zadania|zewnetrzne|dostepnego|Artysci|udalo|zapisac|ustawien|uruchamiac|tydzien|poniedzialek|Wlaczone|dostep|zrodel|Wlasny|podlaczona|usluga|haslo|Wlaczono|Usluga|dostepu|Haslo|hasla|miec|znakow|Nieprawidlowy)\b/,
  tr: /\b(Is Geçmişi|acma|yapilandirin|giris|dugmesini|gorecek|Kullanicilarin|saglayicisiyla|Sanatci|sanatci|sanatcilar|sanatcilari|araciligiyla|kesfet|dinledigi|kullanicilarinin|eslesen|ettigin|baglantili|yayinlari|tabanli|grafigi|Iliskileri|Isbirlikleri|yakin|sirketi|kataloglari|uzerinden|Kitapligi|studyo|albumlerini|Muzik|bolgesel|Kisisellestirilmis|henuz|uygulanmadi|kullanilabilir|baglayin|Once|kaynagi|Yayin|saglayicilar|kullaniliyor|Sinir|Orneklenecek|kayitlar|Populerlik|Baslangic|Iliskiler|Calisma|basina|Bolge|Hizli|Guvenli|Birlesik|onayi|etkinlestir|Izleme|Tum|Yalnizca|yayin|Hicbiri|yalnizca|Gelismis|Sinirlar|suresi|Kutuphane|Kesfi|Kesfin|kadari|kutuphanenizden|gecmisinizden|oldugunuza|guvenir|orani|Gorsel|gorselleri|oncelikle|kaynagindan|kullanilir|anahtari|bagli|Ucretsiz|icin|bos|birakin|yonlendirerek|karsisinda|zenginlestirmesi|Oneri|kartlarinda|baglantilari|goster|Aciklama|degil|onbelleginde|aciklamalar|kapaliyken|Varsayilan|barindiriyorsaniz|ornek|ayarlari|calistirmak|programi|ayarlayin|populer|Ozel|goruntule|Yukleniyor|Gecersiz|Baglantilariniz|Baglantıyi|Sifreyi|Guncelleme|Guncel|Uygulamasi|olustur|onerileri|baglantisi|sifre|Degistiriliyor|yukleniyor|Goruntu|onbellegini|degistirildi|olmalidir|sifreyi|sifreler|uyusmuyor|olusturma|yoksay|yapistir|Album)\b/,
}

// Every locale addresses the user informally, matching the casual English voice.
// These are unambiguous formal pronouns; a legitimate use goes in the allowlist.
const FORMAL_ADDRESS_MARKERS: Record<string, RegExp> = {
  de: /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u,
  fr: /(?<!\p{L})(vous|votre|vos)(?!\p{L})/iu,
  es: /(?<!\p{L})(usted|ustedes)(?!\p{L})/iu,
  it: /(?<!\p{L})(Lei|Suo|Sua|Suoi|Sue)(?!\p{L})/u,
  nl: /(?<!\p{L})(u|uw)(?!\p{L})/u,
  pl: /(?<!\p{L})(Pan|Pani|Państwo|Pana|Panu)(?!\p{L})/u,
  ro: /(?<!\p{L})(dumneavoastră|dvs\.?)(?!\p{L})/iu,
  ru: /(?<!\p{L})(вы|вас|вам|вами|ваш\p{L}*)(?!\p{L})/iu,
  tr: /(?<!\p{L})(siz|sizin|size|sizi|sizde|sizden)(?!\p{L})/iu,
  uk: /(?<!\p{L})(ви|вас|вам|вами|ваш\p{L}*)(?!\p{L})/iu,
}

// 'locale:key' entries where a formal-looking word is not addressing the user.
const FORMAL_ADDRESS_ALLOWLIST = new Set<string>([
  'de:genreDetail.emptyDeepCuts',
  'de:libraryHealth.introTip',
  'nl:systemHealth.inHours',
  'nl:librarySources.hoursAgo',
])

const referenceLocale = 'en'
const referenceMessages = getMessages(referenceLocale)
const UNIVERSAL_SAME_AS_SOURCE_VALUES = new Set([
  ...PROTECTED_I18N_TERMS,
  'Deezer Flow',
  'OpenAI-Compatible',
  'Ollama (local)',
  // Notification-channel type labels are untranslatable product/brand names.
  'Webhook',
  'Telegram',
  'Apprise',
  'N/A',
  'OIDC / SSO',
  'shoegaze',
  // Canonical email placeholder; a format example, identical across locales.
  'you@example.com',
  'Radiohead, Portishead, Massive Attack',
])

// Natural-language loanwords and unchanged labels are exceptions only for the
// locale and key where a native speaker would actually use the English form.
const LOCALE_KEY_SAME_AS_SOURCE_ALLOWLIST = new Set([
  'fr:app.themeMode',
  'fr:genres.genrePlural',
  'fr:genres.genreSingular',
  'fr:common.date',
  'fr:subscriptionForm.source',
  'fr:subscriptionForm.sources',
  'fr:discoveryMode.field.tags',
  'de:app.themeGroupEditor',
  'nl:app.themeGroupEditor',
  'it:auth.password',
  'it:settings.fieldPassword',
  'it:playlists.playlistSingular',
  'it:jobHistory.playlistType',
  'it:integration.playlist',
  'it:cronPicker.preset',
  'pl:setup.model',
  'tr:setup.model',
  'es:discoveryMode.option.global',
  'es:playlist.sourceLocal',
  'es:settings.groups.personal',
  'fr:nav.albums',
  'fr:search.sources',
  'fr:search.sourcesActive',
  'fr:discover.kindFilter',
  'fr:discover.kind.albums',
  'fr:recommendation.albumBadge',
  'fr:discoveryMode.charts.label',
  'fr:discoveryMode.option.france',
  'fr:discoveryMode.option.canada',
  'fr:discoveryMode.option.collaboration',
  'fr:preview.volume',
  'fr:playlist.sourceLocal',
  'de:recommendation.albumBadge',
  'de:discover.statusFilter',
  'de:discoveryMode.charts.label',
  'de:discoveryMode.field.region',
  'de:discoveryMode.option.global',
  'de:discoveryMode.option.japan',
  'pt-BR:discoveryMode.option.global',
  'pt-BR:discover.statusFilter',
  'pt-BR:preview.volume',
  'pt-BR:playlist.sourceLocal',
  'it:recommendation.albumBadge',
  'it:discoveryMode.option.canada',
  'it:preview.volume',
  'nl:nav.albums',
  'nl:discover.statusFilter',
  'nl:discover.kind.albums',
  'nl:settings.tips',
  'nl:recommendation.albumBadge',
  'nl:discoveryMode.option.japan',
  'nl:discoveryMode.option.canada',
  'nl:preview.volume',
  'ro:recommendation.albumBadge',
  'ro:discoveryMode.option.global',
  'ro:discoveryMode.option.canada',
  'ro:genres.artistCountSingular',
  'ro:playlist.sourceLocal',
  'ro:settings.groups.personal',
  'pl:recommendation.albumBadge',
  'pl:discover.statusFilter',
  'pl:discoveryMode.field.region',
  'tr:discoveryMode.option.global',
  'ja:setup.embyUrl',
  'ja:setup.lidarrUrl',
  'ko:setup.embyUrl',
  'ko:setup.lidarrUrl',
  'zh-CN:setup.embyUrl',
  'zh-CN:setup.lidarrUrl',
])

const UI_LITERAL_ALLOWLIST = new Set([
  ...PROTECTED_I18N_TERMS,
  'digarr',
  'OpenAI-Compatible',
  'j/k',
  'openid profile email',
])

function shouldFlagUiLiteral(value: string): boolean {
  const normalized = value
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!/[A-Za-z]{2}/.test(normalized)) return false
  if (/^(?:[a-z]+:\/\/|\/)[^\s]+$/i.test(normalized)) return false
  return !UI_LITERAL_ALLOWLIST.has(normalized)
}

export function findHardcodedUiStrings(file: string, source: string): string[] {
  const issues: string[] = []
  const add = (index: number, value: string) => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!shouldFlagUiLiteral(normalized)) return
    const before = source.slice(0, index)
    const line = before.split('\n').length
    const lastNewline = before.lastIndexOf('\n')
    const column = index - lastNewline
    issues.push(`${file}:${line}:${column}: "${normalized}"`)
  }

  const patterns = [
    /<([A-Za-z][\w.-]*)(?:\s[^>\n]*)?>([^<{]*[A-Za-z]{2}[^<{]*)<\/\1>/g,
    /<((?:p|span|button|label|option|h[1-6]|div|a|li|td|th|strong|small|kbd))(?:\s[^>\n]*)?>\s*([A-Za-z][^<{\n]*?)\s*\{/g,
    /<((?:p|span|button|label|option|h[1-6]|div|a|li|td|th|strong|small|kbd))(?:\s[^>\n]*)?>\s*\{[^}\n]+\}\s*([A-Za-z][^<{\n]*?)\s*<\/\1>/g,
    /(<>)\s*([^<{]*[A-Za-z]{2}[^<{]*)<\/?>/g,
    /\b(?:alt|aria-label|placeholder|title)\s*=\s*(["'])(.*?)\1/g,
    /\b(?:alt|aria-label|placeholder|title)\s*=\s*\{\s*(`)([\s\S]*?)\1\s*\}/g,
    /\b(?:toast\.(?:error|info|success|warning)|alert|confirm)\s*\(\s*(["'])(.*?)\1/g,
    /\b(?:toast\.(?:error|info|success|warning)|alert|confirm)\s*\(\s*(`)([\s\S]*?)\1/g,
    /\{\s*(["'])(.*?)\1\s*\}/g,
    />\s*\{\s*(`)([\s\S]*?)\1\s*\}/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[2]
      if (value == null || match.index == null) continue
      add(match.index + match[0].indexOf(value), value)
    }
  }
  return issues
}

function shouldFlagSameAsSource(locale: string, key: string, value: string): boolean {
  if (!/[A-Za-z]/.test(value)) return false
  if (UNIVERSAL_SAME_AS_SOURCE_VALUES.has(value)) return false
  return !LOCALE_KEY_SAME_AS_SOURCE_ALLOWLIST.has(`${locale}:${key}`)
}

export function findCatalogIssues(
  locale: string,
  sourceCatalog: Record<string, string>,
  translatedCatalog: Record<string, string>,
) {
  const sourceKeys = Object.keys(sourceCatalog)
  const translatedKeys = Object.keys(translatedCatalog)
  const missing = sourceKeys.filter((key) => !(key in translatedCatalog))
  const extra = translatedKeys.filter((key) => !sourceKeys.includes(key))
  const empty = sourceKeys.filter((key) => translatedCatalog[key]?.trim() === '')
  const sameAsSource = sourceKeys.filter((key) => {
    const sourceValue = sourceCatalog[key]
    const translatedValue = translatedCatalog[key]
    if (!sourceValue || !translatedValue) return false
    if (sourceValue !== translatedValue) return false
    return shouldFlagSameAsSource(locale, key, sourceValue)
  })

  return { missing, extra, empty, sameAsSource }
}

export function findAsciiMarkers(locale: string, messages: Record<string, string>): string[] {
  const regex = ASCII_MARKERS[locale]
  if (!regex) return []
  const hits: string[] = []
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === 'string' && regex.test(value)) {
      hits.push(`${key}: "${value}"`)
    }
  }
  return hits
}

export function findFormalAddress(locale: string, messages: Record<string, string>): string[] {
  const regex = FORMAL_ADDRESS_MARKERS[locale]
  if (!regex) return []
  return Object.entries(messages)
    .filter(
      ([key, value]) => regex.test(value) && !FORMAL_ADDRESS_ALLOWLIST.has(`${locale}:${key}`),
    )
    .map(([key, value]) => `${key}: "${value}"`)
}

// User-visible text uses -- as a dash: no em/en dashes and no lone " - ".
export function findDashIssues(messages: Record<string, string>): string[] {
  return Object.entries(messages)
    .filter(([, value]) => /[–—]| - /.test(value))
    .map(([key, value]) => `${key}: "${value}"`)
}

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (full.endsWith('/i18n/messages')) continue
      collectSourceFiles(full, out)
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full)
    }
  }
}

async function findOrphanedKeys(referenceKeys: string[]): Promise<string[]> {
  const files: string[] = []
  collectSourceFiles('src', files)
  const body = files.map((f) => readFileSync(f, 'utf8')).join('\n')

  const exactDynamicKeys = new Set<string>([
    ...ARTIST_EXTERNAL_LINK_KEYS.map((key) => `artist.externalLinks.${key}`),
    ...REJECTION_REASONS.map((reason) => `rejectionReason.${reason}`),
    ...collectDiscoveryMessageKeys(createDefaultDiscoveryModeRegistry().list()),
  ])

  return referenceKeys.filter((key) => {
    if (body.includes(key)) return false
    return !exactDynamicKeys.has(key)
  })
}

export async function main(): Promise<void> {
  let failed = false

  for (const locale of SUPPORTED_LOCALES) {
    const messages = getRawMessages(locale) as Record<string, string>
    const { missing, extra, empty, sameAsSource } = findCatalogIssues(
      locale,
      referenceMessages,
      messages,
    )
    const untranslated = locale === referenceLocale ? [] : sameAsSource
    const asciiHits = findAsciiMarkers(locale, messages)
    const formalHits = findFormalAddress(locale, messages)
    const dashHits = findDashIssues(messages)
    let qualityError: string | null = null
    if (locale !== referenceLocale) {
      try {
        validateTranslatedCatalog(referenceMessages, messages)
      } catch (error) {
        qualityError = error instanceof Error ? error.message : String(error)
      }
    }

    if (
      missing.length === 0 &&
      extra.length === 0 &&
      empty.length === 0 &&
      untranslated.length === 0 &&
      asciiHits.length === 0 &&
      formalHits.length === 0 &&
      dashHits.length === 0 &&
      qualityError == null
    ) {
      continue
    }

    failed = true
    console.error(`Locale ${locale} has catalog issues:`)
    if (missing.length > 0) console.error(`  missing: ${missing.join(', ')}`)
    if (extra.length > 0) console.error(`  extra: ${extra.join(', ')}`)
    if (empty.length > 0) console.error(`  empty: ${empty.join(', ')}`)
    if (untranslated.length > 0) console.error(`  untranslated: ${untranslated.join(', ')}`)
    if (asciiHits.length > 0) console.error(`  ascii-stripped: ${asciiHits.join('; ')}`)
    if (formalHits.length > 0) console.error(`  formal-address: ${formalHits.join('; ')}`)
    if (dashHits.length > 0) console.error(`  dash-style: ${dashHits.join('; ')}`)
    if (qualityError) console.error(`  quality: ${qualityError}`)
  }

  const drift = findSourceLockDrift(referenceMessages, readSourceLock())
  const unstamped = [...drift.changed, ...drift.added, ...drift.removed]
  if (unstamped.length > 0) {
    failed = true
    console.error(
      'English changed since the translations were last stamped. Update every locale, then run `bun run i18n:stamp`:',
    )
    for (const key of drift.changed) console.error(`  changed: ${key}`)
    for (const key of drift.added) console.error(`  added: ${key}`)
    for (const key of drift.removed) console.error(`  removed: ${key}`)
  }

  const orphans = await findOrphanedKeys(Object.keys(referenceMessages))
  if (orphans.length > 0) {
    failed = true
    console.error(`Orphaned keys (in en.ts, not referenced in src/):`)
    for (const key of orphans) console.error(`  - ${key}`)
  }

  const webFiles: string[] = []
  collectSourceFiles('src/web', webFiles)
  const hardcodedUi = webFiles.flatMap((file) =>
    findHardcodedUiStrings(file, readFileSync(file, 'utf8')),
  )
  if (hardcodedUi.length > 0) {
    failed = true
    console.error('Hardcoded user-facing strings:')
    for (const issue of hardcodedUi) console.error(`  - ${issue}`)
  }

  if (failed) {
    process.exit(1)
  }

  console.log(
    `Validated ${SUPPORTED_LOCALES.length} locales against ${referenceLocale}; no catalog, quality, orphan, ASCII-marker, address, dash, source-lock, or hardcoded-UI issues.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
