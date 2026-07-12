# Encryption Key Rotation

`DIGARR_ENCRYPTION_KEY` is used to encrypt sensitive columns (API keys,
tokens, passwords) at rest. Rotate it periodically so key compromise has a
bounded blast radius.

The app supports a dual-key mode via `DIGARR_ENCRYPTION_KEY_NEXT`: when set,
`decryptField` tries the primary key first, then falls back to the next key,
then to the legacy SHA-256 key. Writes always use the primary. This lets
external-PostgreSQL rotation happen with zero downtime at the cost of three
deploys plus two script passes (rotation, then primary-key-only verification).
Embedded PGlite requires a maintenance window because no second process may
open the live data directory while the app owns it.

## Encrypted sites

Rotation touches these columns:

- `settings.lidarr_api_key`, `settings.ai_api_key`, `settings.audiodb_api_key`, `settings.oidc_client_secret`, `settings.tidal_client_secret`
- `settings.preferences.fanartApiKey` (nested in jsonb)
- `users.listenbrainz_token`, `users.lastfm_api_key`, `users.plex_token`, `users.jellyfin_api_key`, `users.emby_api_key`, `users.discogs_token`, `users.subsonic_password`
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

4. **Run the rotation script.** Select the same backend the app uses: set
   `DATABASE_URL` for external PostgreSQL, or leave the DSN unset and set
   `DB_PATH` for embedded PGlite.

   External PostgreSQL can remain online while the app continues running with
   both keys. For embedded PGlite, stop the app/container first and keep it
   stopped through step 5; run the script from a one-off process with the same
   data directory mounted at `DB_PATH`.

   ```sh
   DATABASE_URL=postgresql://... \
   DIGARR_ENCRYPTION_KEY=<new> \
   DIGARR_ENCRYPTION_KEY_NEXT=<old> \
   bun scripts/rotate-encryption-key.ts
   ```

   For PGlite, replace `DATABASE_URL=...` with `DB_PATH=/app/data` (or the
   active data directory).

   The script reads every `enc:v1:` value, decrypts through the
   primary/next/legacy chain, and re-encrypts under the primary (new key).
   Safe to re-run; idempotent because every write uses a fresh IV. It exits
   nonzero if any encrypted value cannot be rewritten. Do not continue while
   the output contains a `skip` line or reports an incomplete rotation.

5. **Verify every encrypted value using only the new key.** For external
   PostgreSQL, keep the running app on the dual-key configuration from step 3.
   For PGlite, leave the app stopped. Invoke a second one-off pass with
   `DIGARR_ENCRYPTION_KEY_NEXT` removed from that process:

   ```sh
   env -u DIGARR_ENCRYPTION_KEY_NEXT \
   DATABASE_URL=postgresql://... \
   DIGARR_ENCRYPTION_KEY=<new> \
   bun scripts/rotate-encryption-key.ts
   ```

   For PGlite, replace `DATABASE_URL=...` with `DB_PATH=/app/data` (or the
   active data directory). This pass checks every scalar, nested preference,
   and target-config ciphertext, not a sample. It re-encrypts values again with
   fresh IVs and exits nonzero if any value still requires the old key.

6. **Deploy a third time to drop NEXT.** For PGlite, this is when the stopped
   app restarts after the two script passes.

   ```sh
   DIGARR_ENCRYPTION_KEY=<new>
   # DIGARR_ENCRYPTION_KEY_NEXT unset
   ```

   The old key is now retired only after the all-site verification pass.

## Rollback

If a deploy fails before step 4 starts, revert by restoring the old key as
primary. If step 4 starts and then fails, keep both keys configured: rotation is
row-by-row, so the database may contain ciphertext written by either key. Fix
the reported rows and rerun step 4, or restore the pre-rotation backup. Do not
remove either key until the verification step succeeds.

After step 6 completes, rollback requires restoring a pre-rotation backup
(see the Backup & Restore guide).
