# i18n messages

Translations for digarr's 15 supported locales.

## Layout

- `en.ts` -- canonical English catalog. All keys originate here.
- `<locale>.ts` (one of `de`, `es`, `fr`, `it`, `ja`, `ko`, `nl`, `pl`,
  `pt-BR`, `ro`, `ru`, `tr`, `uk`, `zh-CN`) -- full translated catalog.
- `overrides/<locale>.ts` -- per-locale deltas that track English renames or
  focused corrections without rewriting the full catalog.
- `types.ts` -- `MessageKey` and `MessageCatalog` types derived from `en`.
- `index.ts` -- `getMessages(locale)` resolver.

## Resolution order

At runtime `getMessages(locale)` returns:

```ts
{ ...en, ...localeCatalog, ...(MESSAGE_OVERRIDES[locale] ?? {}) }
```

English is always the runtime base, so a missing key degrades to readable
English instead of an empty label. That is a runtime safety net, not a shipping
policy: `bun run i18n:check` validates each resolved locale and rejects values
that still equal the English source outside the proper-noun allowlist. A missing
locale entry therefore normally fails as untranslated; allowlisted proper nouns
may legitimately resolve from the English base.

## The overrides layer

Catalog files (`<locale>.ts`) represent the initial translation pass for each
locale. When a new English key is added or renamed, the per-locale override
modules provide a focused place to carry the translated delta until it is
folded into the base catalogs. Every resolved locale must pass the validator;
the allowlist covers values that should remain identical across languages.

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
2. Add a translation for each of the 14 non-English locales, either directly
   in its catalog or in `overrides/<locale>.ts`. Proper nouns and protocol terms
   may remain identical only when covered by the validator's allowlist.
3. Run `bun run i18n:check`; empty, orphaned, or untranslated resolved values
   block the change.
4. Fold stable override entries back into the base catalogs periodically.

## Renaming a key

1. Rename in `en.ts`.
2. Update callers (`t('new.key')`).
3. Either rename in every locale catalog or add the replacement key to each
   locale's module under `overrides/`.
4. Run `bun run i18n:check` to confirm nothing regressed.

## Removing a key

1. Remove from `en.ts`.
2. Remove all callers (`t('old.key')`).
3. `bun run i18n:check` reports orphaned keys that still exist in
   locale catalogs but no longer appear in `en.ts`. Delete those
   entries from each locale file and any override block.

## Validation

`scripts/i18n-check.ts` runs in CI. It fails on:

- **Missing non-allowlisted translations** -- an absent raw locale entry falls
  back to English and is caught indirectly as untranslated. Allowlisted proper
  nouns may intentionally use that fallback.
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
  prefixes (`discoveryMode.`, `pipeline.stage.`, `pipeline.description.`,
  `artist.externalLinks.`, `libraryHealth.`, and `rejectionReason.`) so the
  check doesn't flag labels that are built at runtime.

Run locally: `bun run i18n:check`.

## Accented characters

Accented characters (`ü`, `é`, `á`, `ñ`, `ç`, `ö`, `ł`, `ș`, `ü`, etc.)
**are** correct inside locale catalogs. The "no fancy punctuation"
style rule applies to project prose and code, not to native-language
content. The `i18n:check` validator enforces this
for German and Spanish by failing on known ASCII substitutions.

## Error codes

Backend route errors emit a stable i18n key in the `code` field of
`problem+json` responses (see `src/server/helpers/problem.ts`). The
client (`src/web/lib/api.ts`) translates the code against the active
locale and falls back to the `title` field when no translation exists.
Add error-code keys under the `errors.*` namespace in `en.ts` and
provide translations for all 14 non-English locales, either in their catalogs
or in `overrides/<locale>.ts`.
