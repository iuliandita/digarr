# i18n messages

Translations for digarr's 15 supported locales.

## Layout

- `en.ts` -- canonical English catalog. All keys originate here.
- `<locale>.ts` (one of `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`,
  `pt-BR`, `ro`, `ru`, `tr`, `uk`, `zh-CN`) -- full translated catalog.
- `types.ts` -- `MessageKey` and `MessageCatalog` types derived from `en`.
- `index.ts` -- `getMessages(locale)` resolver.
- `source-lock.json` -- a hash of each English value the translations were
  last written against. Maintained by `bun run i18n:stamp`; never edit by hand.

## Conventions

- Address the user informally in every locale, matching the casual English
  voice: du (de), tu (fr, es, it, ro), je (nl), ty (pl), ты (ru), ти (uk),
  sen (tr), você (pt-BR). Japanese, Korean and Chinese keep their usual polite
  UI register.
- Use a plain hyphen for a dash in user-visible text (`Setup failed - try
  again`, `2-50`), never an em dash, en dash or `--`.

## Resolution order

At runtime `getMessages(locale)` returns:

```ts
{ ...en, ...localeCatalog }
```

English is always the runtime base, so a missing key degrades to readable
English instead of an empty label. That is a runtime safety net, not a shipping
policy: `bun run i18n:check` validates each authored locale catalog before
applying the English fallback. Every English key must be
authored in each locale, including proper nouns and protocol terms. The checker
then rejects values that still equal the English source unless the value is a
universal technical name or the exact locale-key pair is approved. The English
merge remains only as a runtime safety net; each locale file is the complete,
reviewable source of truth.

## Adding a key

1. Add the key and English value to `en.ts`.
2. Add a translation directly to each of the 14 non-English locale catalogs.
   Proper nouns and protocol terms may remain identical only when covered by
   the validator's allowlist.
3. Run `bun run i18n:stamp`, then `bun run i18n:check`; missing, empty,
   orphaned, or untranslated authored values block the change.

## Changing English text

Editing an English value makes `i18n:check` fail until the change is stamped,
so translations cannot silently fall behind the English.

1. Edit the value in `en.ts`.
2. Update the same key in all 14 locale catalogs, by hand or with
   `bun run i18n:translate --stale --write`, which translates only the keys
   whose English changed since the last stamp (set `TRANSLATION_BASE_URL`,
   `TRANSLATION_API_KEY` and optionally `TRANSLATION_MODEL` for any
   OpenAI-compatible endpoint). Review machine output before stamping.
3. Run `bun run i18n:stamp`. It refuses to stamp a key whose English changed
   while some translation of it did not (compared with the merge base of
   `develop`; override with `--base <ref>`).
4. If the English edit needs no translation change (a typo or casing fix),
   stamp it explicitly: `bun run i18n:stamp --source-only <key>[,<key>]`.

## Renaming a key

1. Rename in `en.ts`.
2. Update callers (`t('new.key')`).
3. Rename the key in every locale catalog.
4. Run `bun run i18n:stamp` and `bun run i18n:check` to confirm nothing regressed.

## Removing a key

1. Remove from `en.ts`.
2. Remove all callers (`t('old.key')`).
3. `bun run i18n:stamp`, then `bun run i18n:check` reports orphaned keys that still exist in
   locale catalogs but no longer appear in `en.ts`. Delete those
   entries from each locale file.

## Validation

`scripts/i18n-check.ts` runs in CI. It fails on:

- **Missing authored translations** -- every key must exist in the raw locale
  catalog before runtime fallback is applied.
- **Extra keys** -- present in a locale but not in `en.ts` (stale).
- **Empty values** -- a locale ships an empty string.
- **Untranslated values** -- locale value literally equals the English source
  except for universal technical names and explicit locale-key exceptions.
- **Placeholder drift** -- a locale drops, adds, or renames a placeholder.
  Numbered placeholders may move to fit the target language's grammar.
- **Protected-name drift** -- product and service names such as Digarr, Lidarr,
  Emby, OpenAI, and ListenBrainz, plus protocol/file acronyms, must remain exact
  inside translated copy. The generator and CI checker share one protected-term
  registry.
- **ASCII-stripped diacritics** -- values that use stripped or substituted
  spelling (`Kuenstler`, `Configuracion`, `Sanatci`) instead of native
  characters (`Künstler`, `Configuración`, `Sanatçı`). The high-confidence
  regression markers live in `scripts/i18n-check.ts`.
- **Unstamped English changes** -- an English value, added key, or removed
  key that `source-lock.json` does not match yet.
- **Formal address** -- per-locale formal pronouns (`Sie`, `vous`, `u`, `вы`,
  ...). A word that only looks formal (German "Sie" meaning "they") goes in
  `FORMAL_ADDRESS_ALLOWLIST` as `locale:key`.
- **Dash style** -- em dashes, en dashes or `--` in any catalog.
- **Orphaned keys** -- keys present in `en.ts` but not referenced
  anywhere in `src/**/*.{ts,tsx}` outside `i18n/messages/`. Template
  literal access is resolved to exact live keys from the discovery, rejection,
  and artist-link registries, so an arbitrary key cannot hide under a dynamic
  prefix.
- **Hard-coded UI copy** -- static JSX text, translatable attributes, dialog
  strings, and toast literals must use catalog keys. Product names and format
  examples have a narrow allowlist.

Registry-derived tests add stricter coverage for dynamic discovery-mode and
rejection-reason keys so the prefix exemptions cannot hide dead entries. They
also require every registry help string to route through a live catalog key.
Catalog tests also require every raw locale file to contain the complete English
key set.

Run locally: `bun run i18n:check`.

## Spell check (advisory)

`bun run i18n:spell [<locale>...]` runs hunspell over the translated catalogs
and lists each unknown word once per language, with the key it appears in. It
catches typos and stripped accents the ASCII-marker list misses. It needs
`hunspell` plus the dictionaries (Debian/Ubuntu `hunspell-de-de`,
`hunspell-fr`, ...; or set `DICPATH` to a folder of `.aff`/`.dic` files);
languages without a dictionary are skipped and named. Japanese, Korean and
Chinese are not checked. Correct words the dictionary does not know go in
`scripts/i18n-spell-allowlist.txt`. CI runs it in the non-blocking
`i18n-spell` job and posts the report to the job summary.

## Accented characters

Accented characters (`ü`, `é`, `á`, `ñ`, `ç`, `ö`, `ł`, `ș`, `ü`, etc.)
**are** correct inside locale catalogs. The "no fancy punctuation"
style rule applies to project prose and code, not to native-language
content. The `i18n:check` validator enforces this across accented-language
catalogs by failing on known ASCII substitutions.

## Error codes

Backend route errors emit a stable i18n key in the `code` field of
`problem+json` responses (see `src/server/helpers/problem.ts`). The
client (`src/web/lib/api.ts`) translates the code against the active
locale and falls back to the `title` field when no translation exists.
Add error-code keys under the `errors.*` namespace in `en.ts` and
provide translations directly in all 14 non-English locale catalogs.
