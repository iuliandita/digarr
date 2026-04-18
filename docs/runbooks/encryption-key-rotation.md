# Encryption Key Rotation

`DIGARR_ENCRYPTION_KEY` is used to encrypt sensitive columns (API keys,
tokens, passwords) at rest. Rotate it periodically so key compromise has a
bounded blast radius.

The app supports a dual-key mode via `DIGARR_ENCRYPTION_KEY_NEXT`: when set,
`decryptField` tries the primary key first, then falls back to the next key,
then to the legacy SHA-256 key. Writes always use the primary. This lets
rotation happen with zero downtime at the cost of two deploys plus one
data-migration pass.

## Encrypted sites

Rotation touches these columns:

- `settings.lidarr_api_key`, `settings.ai_api_key`, `settings.oidc_client_secret`
- `settings.preferences.fanartApiKey` (nested in jsonb)
- `users.listenbrainz_token`, `users.lastfm_api_key`, `users.plex_token`, `users.jellyfin_api_key`, `users.emby_api_key`, `users.discogs_token`
- `oauth_tokens.access_token`, `oauth_tokens.refresh_token`, `oauth_tokens.client_secret`
- `oidc_tokens.access_token`, `oidc_tokens.refresh_token`, `oidc_tokens.id_token`
- `targets.config` (any `enc:v1:`-prefixed string values)

## Procedure

1. **Generate a new key.**

   ```sh
   openssl rand -base64 32
   ```

2. **Deploy with both keys set (primary unchanged, NEXT = new).**

   ```sh
   DIGARR_ENCRYPTION_KEY=<old>
   DIGARR_ENCRYPTION_KEY_NEXT=<new>
   ```

   The app still writes with the old key. Existing ciphertext continues to
   decrypt through the primary. NEXT is unused yet but the binary is now
   capable of reading values encrypted with either key.

3. **Deploy again with the roles swapped (primary = new, NEXT = old).**

   ```sh
   DIGARR_ENCRYPTION_KEY=<new>
   DIGARR_ENCRYPTION_KEY_NEXT=<old>
   ```

   New writes land under the new key. Old ciphertext still decrypts via the
   NEXT fallback. There's a window here where the DB has a mix of
   old-encrypted and new-encrypted values.

4. **Run the rotation script.** (Point `DATABASE_URL` at the target DB.)

   ```sh
   DATABASE_URL=postgresql://... \
   DIGARR_ENCRYPTION_KEY=<new> \
   DIGARR_ENCRYPTION_KEY_NEXT=<old> \
   bun scripts/rotate-encryption-key.ts
   ```

   The script reads every `enc:v1:` value, decrypts through the
   primary/next/legacy chain, and re-encrypts under the primary (new key).
   Safe to re-run; idempotent because every write uses a fresh IV.

5. **Deploy a third time to drop NEXT.**

   ```sh
   DIGARR_ENCRYPTION_KEY=<new>
   # DIGARR_ENCRYPTION_KEY_NEXT unset
   ```

   The old key is now retired. If a stale encrypted value from before step 4
   survived, decryption will now fail loudly instead of silently falling back
   to the old key.

## Verification

After step 5, sample a few sensitive columns and confirm:

```sh
DATABASE_URL=postgresql://... \
DIGARR_ENCRYPTION_KEY=<new> \
bun -e "
  import { decryptField, initEncryption } from './src/core/crypto'
  import { db, pool } from './src/db'
  import { sql } from 'drizzle-orm'
  initEncryption(process.env.DIGARR_ENCRYPTION_KEY)
  const r = await db.execute(sql\`SELECT id, lastfm_api_key FROM users WHERE lastfm_api_key IS NOT NULL LIMIT 5\`)
  for (const row of r.rows) console.log(row.id, '->', decryptField(row.lastfm_api_key))
  await pool.end()
"
```

Every row should decrypt cleanly. A `Decryption failed` throw means the
rotation pass missed a row - re-run step 4 with NEXT still set to the old
key, then retry step 5.

## Rollback

If any step fails before step 5, revert by re-setting
`DIGARR_ENCRYPTION_KEY` to the old key and deleting
`DIGARR_ENCRYPTION_KEY_NEXT`. All data remains readable because nothing is
re-encrypted until step 4 runs successfully.

After step 5 completes, rollback requires restoring a pre-rotation backup
(see the Backup & Restore guide).
