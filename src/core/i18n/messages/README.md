# i18n messages

Translations for digarr's 15 supported locales.

## Layout

- `en.ts` -- canonical English catalog. All keys originate here.
- `<locale>.ts` (one of `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`,
  `pt-BR`, `ro`, `ru`, `tr`, `uk`, `zh-CN`) -- full translated catalog.
- `types.ts` -- `MessageKey` and `MessageCatalog` types derived from `en`.
- `index.ts` -- `getMessages(locale)` resolver.

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
3. Run `bun run i18n:check`; missing, empty, orphaned, or untranslated authored values
   block the change.

## Renaming a key

1. Rename in `en.ts`.
2. Update callers (`t('new.key')`).
3. Rename the key in every locale catalog.
4. Run `bun run i18n:check` to confirm nothing regressed.

## Removing a key

1. Remove from `en.ts`.
2. Remove all callers (`t('old.key')`).
3. `bun run i18n:check` reports orphaned keys that still exist in
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
