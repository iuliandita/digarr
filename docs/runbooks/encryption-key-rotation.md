# Encryption Key Rotation

`DIGARR_ENCRYPTION_KEY` is used to encrypt sensitive columns (API keys,
tokens, passwords) at rest. Rotate it periodically so key compromise has a
bounded blast radius.

The app supports a dual-key mode via `DIGARR_ENCRYPTION_KEY_NEXT`: when set,
`decryptField` tries the primary key first, then falls back to the next key,
then to the legacy SHA-256 key. Writes always use the primary. This lets
the app read old and new ciphertext during the transition. The two script
passes require a no-write maintenance window on both database backends. The
rotation script updates rows after reading them and could otherwise overwrite a
concurrent settings change. Embedded PGlite also permits only one process to
open its live data directory.

## Encrypted sites

Rotation touches these columns:

- `settings.lidarr_api_key`, `settings.ai_api_key`, `settings.audiodb_api_key`, `settings.oidc_client_secret`, `settings.tidal_client_secret`
- `settings.preferences.fanartApiKey` (nested in jsonb)
- `users.listenbrainz_token`, `users.lastfm_api_key`, `users.plex_token`, `users.jellyfin_api_key`, `users.emby_api_key`, `users.discogs_token`, `users.subsonic_password`
- `oauth_tokens.access_token`, `oauth_tokens.refresh_token`, `oauth_tokens.client_secret`
- `targets.config` (any `enc:v1:`-prefixed string values)

OIDC provider tokens are not retained and therefore have no rotation site.

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

4. **Stop app writes and run the rotation script.** Stop every Digarr app
   instance. Keep external PostgreSQL running; for embedded PGlite, no other
   process may have the data directory open. Keep the app stopped through step
   5.

   Create a protected, backend-consistent backup before the first write. For
   the bundled PostgreSQL stack:

   ```sh
   install -d -m 700 "$HOME/digarr-backups"
   docker compose -f deploy/docker/docker-compose.yml stop app
   docker compose -f deploy/docker/docker-compose.yml exec -T postgres \
     sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
     > "$HOME/digarr-backups/pre-rotation.dump"
   chmod 600 "$HOME/digarr-backups/pre-rotation.dump"
   docker compose -f deploy/docker/docker-compose.yml exec -T postgres \
     pg_restore --list < "$HOME/digarr-backups/pre-rotation.dump" > /dev/null
   ```

   For embedded PGlite, stop the app before copying its data volume:

   ```sh
   install -d -m 700 "$HOME/digarr-backups"
   docker compose -f deploy/docker/docker-compose.pglite.yml stop app
   docker compose -f deploy/docker/docker-compose.pglite.yml run --rm --no-deps \
     --entrypoint sh app -c 'tar -C /app/data -cf - .' \
     > "$HOME/digarr-backups/pre-rotation.tar"
   chmod 600 "$HOME/digarr-backups/pre-rotation.tar"
   tar -tf "$HOME/digarr-backups/pre-rotation.tar" > /dev/null
   ```

   Keep this backup until the rotation and a normal app startup both succeed.
   Use the backup method for your platform if you do not use the bundled
   Compose files.

   The release image contains the compiled tool at
   `dist/scripts/rotate-encryption-key.js`. Store the keys in a mode-0600 file
   outside the checkout so they do not appear in shell history, process
   arguments, or an accidental Git commit:

   ```sh
   install -d -m 700 "$HOME/.config/digarr/rotation"
   install -m 600 /dev/null "$HOME/.config/digarr/rotation/primary.env"
   ```

   Edit `$HOME/.config/digarr/rotation/primary.env` with this content:

   ```dotenv
   DIGARR_ENCRYPTION_KEY=<new>
   DIGARR_ENCRYPTION_KEY_NEXT=<old>
   ```

   For the bundled external-PostgreSQL Compose stack:

   ```sh
   docker compose -f deploy/docker/docker-compose.yml run --rm --no-deps \
     --env-from-file "$HOME/.config/digarr/rotation/primary.env" \
     --entrypoint bun app \
     dist/scripts/rotate-encryption-key.js
   ```

   For the embedded-PGlite Compose stack, use the PGlite file so the one-off
   container mounts the same `/app/data` volume:

   ```sh
   docker compose -f deploy/docker/docker-compose.pglite.yml run --rm --no-deps \
     --env-from-file "$HOME/.config/digarr/rotation/primary.env" \
     --entrypoint bun app \
     dist/scripts/rotate-encryption-key.js
   ```

   A source checkout can run `bun scripts/rotate-encryption-key.ts` instead.
   Select the same backend as the app with `DATABASE_URL` for external
   PostgreSQL or `DB_PATH` for embedded PGlite, and load the keys from a
   protected environment file rather than placing them on the command line.

   The script reads every `enc:v1:` value, decrypts through the
   primary/next/legacy chain, and re-encrypts under the primary (new key).
   Safe to repeat: plaintext semantics are preserved even though every pass
   emits fresh ciphertext with a new IV. It exits nonzero if any encrypted
   value cannot be rewritten. Do not continue while the output contains a
   `skip` line or reports an incomplete rotation.

5. **Verify every encrypted value using only the new key.** Leave every app
   instance stopped. Create a second protected file so NEXT is explicitly
   blank even if the Compose service's normal `.env` file defines it:

   ```sh
   install -m 600 /dev/null "$HOME/.config/digarr/rotation/verify.env"
   ```

   Edit `$HOME/.config/digarr/rotation/verify.env` with this content:

   ```dotenv
   DIGARR_ENCRYPTION_KEY=<new>
   DIGARR_ENCRYPTION_KEY_NEXT=
   ```

   Re-run the same Compose command from step 4 with
   `--env-from-file "$HOME/.config/digarr/rotation/verify.env"`. This pass
   checks every scalar, nested preference, and target-config ciphertext, not a
   sample. It re-encrypts values again with fresh IVs and exits nonzero if any
   value still requires the old key.

6. **Deploy a third time to drop NEXT.** Restart the stopped app instances only
   after both script passes succeed.

   ```sh
   DIGARR_ENCRYPTION_KEY=<new>
   # DIGARR_ENCRYPTION_KEY_NEXT unset
   ```

   The old key is now retired only after the all-site verification pass.

   Delete the temporary key files after the deployment succeeds:

   ```sh
   rm "$HOME/.config/digarr/rotation/primary.env" \
     "$HOME/.config/digarr/rotation/verify.env"
   rmdir "$HOME/.config/digarr/rotation"
   ```

## Rollback

If a deploy fails before step 4 starts, revert by restoring the old key as
primary. If step 4 starts and then fails, keep both keys configured: rotation is
row-by-row, so the database may contain ciphertext written by either key. Fix
the reported rows and rerun step 4, or restore the pre-rotation backup. Do not
remove either key until the verification step succeeds.

After step 6 completes, rollback requires restoring a pre-rotation backup
(see the Backup & Restore guide).
