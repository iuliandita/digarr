# i18n messages

Translations for digarr's 15 supported locales.

## Layout

- `en.ts` -- canonical English catalog. All keys originate here.
- `<locale>.ts` (one of `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`,
  `pt-BR`, `ro`, `ru`, `tr`, `uk`, `zh-CN`) -- full translated catalog.
- `overrides.ts` -- per-locale deltas that track upstream English renames
  without rewriting the full catalog.
- `types.ts` -- `MessageKey` and `MessageCatalog` types derived from `en`.
- `index.ts` -- `getMessages(locale)` resolver.

## Resolution order

At runtime `getMessages(locale)` returns:

```ts
{ ...en, ...localeCatalog, ...(MESSAGE_OVERRIDES[locale] ?? {}) }
```

English is always the base, so any missing key falls back to the English
string. This means a locale can ship without every key and still render a
readable UI -- it will just show English for the missing entries. The
`bun run i18n:check` validator flags these same-as-source cases so the
backlog stays visible.

## The overrides layer

Catalog files (`<locale>.ts`) represent the initial translation pass for
each locale. When a new English key is added or an existing key is
renamed, touching every locale catalog is expensive -- especially for
languages we ship without native reviewers. `overrides.ts` exists so we
can ship a string change immediately against English, add native
translations for as many locales as we have capacity for, and let the
rest fall through until someone translates them.

Two layers means one policy: **overrides win**. An entry in
`MESSAGE_OVERRIDES[locale]` always supersedes the base catalog for that
locale. This lets us correct a mistranslation without hunting through
the base file, or hot-patch a string that changed upstream without
touching 14 files.

The cost: overrides drift. Periodically fold the overrides back into
the base catalogs so `<locale>.ts` stays the source of truth for
manual review.

## Adding a key

1. Add the key and English value to `en.ts`.
2. Either:
   - Add translations to each of the 14 locale catalog files, OR
   - Leave the key in `en.ts` only (it falls back to English).
3. Run `bun run i18n:check` to see which locales lack a translation.
4. If a locale should diverge from the base catalog, add an entry to
   that locale's block in `overrides.ts`.

## Renaming a key

1. Rename in `en.ts`.
2. Update callers (`t('new.key')`).
3. Either rename in every locale, or add override mappings in
   `overrides.ts` under each locale block.
4. Run `bun run i18n:check` to confirm nothing regressed.

## Removing a key

1. Remove from `en.ts`.
2. Remove all callers (`t('old.key')`).
3. `bun run i18n:check` reports orphaned keys that still exist in
   locale catalogs but no longer appear in `en.ts`. Delete those
   entries from each locale file and any override block.

## Validation

`scripts/i18n-check.ts` runs in CI. It fails on:

- **Missing keys** -- present in `en.ts` but absent from a locale.
- **Extra keys** -- present in a locale but not in `en.ts` (stale).
- **Empty values** -- a locale ships an empty string.
- **Untranslated values** -- locale value literally equals the English
  source (except for allowlisted proper nouns, protocol acronyms, etc.).
- **ASCII-stripped diacritics** -- German or Spanish values that still
  use ASCII substitutions (`Kuenstler`, `Configuracion`) instead of the
  native characters (`Künstler`, `Configuración`). The regex lives in
  `scripts/i18n-check.ts`.
- **Orphaned keys** -- keys present in `en.ts` but not referenced
  anywhere in `src/**/*.{ts,tsx}` outside `i18n/messages/`. Template
  literal access is recognised for a small allowlist of dynamic
  prefixes (`discoveryMode.`, `pipeline.stage.`, `pipeline.description.`)
  so the check doesn't flag mode labels that are built at runtime.

Run locally: `bun run i18n:check`.

## Accented characters

Accented characters (`ü`, `é`, `á`, `ñ`, `ç`, `ö`, `ł`, `ș`, `ü`, etc.)
**are** correct inside locale catalogs. The global "no fancy
punctuation" rule in `CLAUDE.md` applies to project prose and code, not
to native-language content. The `i18n:check` validator enforces this
for German and Spanish by failing on known ASCII substitutions.

## Error codes

Backend route errors emit a stable i18n key in the `code` field of
`problem+json` responses (see `src/server/helpers/problem.ts`). The
client (`src/web/lib/api.ts`) translates the code against the active
locale and falls back to the `title` field when no translation exists.
Add error-code keys under the `errors.*` namespace in `en.ts` and
provide translations via `overrides.ts`.
