# Encryption Key Rotation

`DIGARR_ENCRYPTION_KEY` is used to encrypt sensitive columns (API keys,
tokens, passwords) at rest. Changing the key requires re-encrypting saved values; changing the environment variable alone is not a completed rotation.

The app supports a dual-key mode via `DIGARR_ENCRYPTION_KEY_NEXT`: when set,
`decryptField` tries the primary key first, then falls back to the next key,
then to the legacy SHA-256 derivations of the primary and next keys, in that order. Writes always use the primary. This lets
the app read old and new ciphertext during the transition. The two script
passes require a no-write maintenance window on both database backends. The
rotation script updates rows after reading them and could otherwise overwrite a
concurrent settings change. Embedded PGlite also permits only one process to
open its live data directory.

## Encrypted sites

Rotation touches these columns:

- `settings.lidarr_api_key`, `settings.ai_api_key`, `settings.audiodb_api_key`, `settings.oidc_client_secret`, `settings.tidal_client_secret`
- `settings.preferences.fanartApiKey` (nested in jsonb)
- Encrypted fields in `settings.preferences.channels`, including webhook URLs, Telegram bot tokens, ntfy tokens, and Apprise URLs
- `users.listenbrainz_token`, `users.lastfm_api_key`, `users.plex_token`, `users.jellyfin_api_key`, `users.emby_api_key`, `users.discogs_token`, `users.subsonic_password`
- `oauth_tokens.access_token`, `oauth_tokens.refresh_token`, `oauth_tokens.client_secret`
- `targets.config` (any `enc:v1:`-prefixed string values)

**v1.19.0 exclusion:** the script does not scan `users.preferences`, including per-user `fanartApiKey` ([issue #760](https://github.com/iuliandita/digarr/issues/760)). A successful script pass does not verify those values. While both keys remain available, re-enter and save affected per-user credentials under the new primary key. Independently verify them with only the new key before retiring the fallback; if you cannot verify them, retain it.

OIDC provider tokens are not retained and therefore have no rotation site.

Pending Spotify, Deezer, and TIDAL transactions store encrypted payloads and client secrets in `oauth_pending_auths`. The rotation script and application JSON backups omit this table. Complete unfinished connects before the maintenance window or let their 10-minute lifetime expire, then restart unfinished attempts after rotation. Do not retire the fallback while a pending transaction still needs it.

The Compose examples require `docker compose run --help` to list `--env-from-file`. Check support before the maintenance window; upgrade Compose if the option is absent.

## Preserve the exact key bytes

Keys are byte-sensitive. An older Kubernetes example used `kubectl create secret --from-file` with a key file written by `openssl rand -hex 32`; that file includes a trailing newline. If deployed that way, the newline is part of the existing key. Do not strip it, trim it, or retype only the visible hex characters. Preserve the original Secret bytes, including newlines, for both the app and the rotation tool and in recovery copies.

The single-line environment-file examples below assume both keys are single-line values. They cannot represent an existing newline-containing key as shown. For that installation, inject the original Secret value into both the app and the rotation tool through the same byte-preserving Secret environment mechanism, rather than converting it to the illustrated environment files. Verify the tool receives the same key bytes before writing database rows.

## First key on an existing installation

Adding a key does not encrypt previously saved plaintext credentials. After setting the key and restarting, re-enter and save each service credential, OAuth connection, target, and notification channel. Masked placeholders may preserve old values; supply the actual credential again. The rotation script only rewrites `enc:v1:` values and is not a plaintext migration tool.

## Procedure

1. **Generate a new key.**

   ```sh
   openssl rand -hex 32
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
   instance. Keep the PostgreSQL server running; for embedded PGlite, no other
   process may have the data directory open. Keep the app stopped through step
   5.

   Create and verify a protected, backend-consistent backup before the rotation tool writes using the [Docker backup procedure](../../deploy/docker/README.md#back-up-and-update). Leave the app stopped after the backup checks instead of running that procedure's restart or update commands. This backup is taken after the primary swap and can contain values encrypted with either key. Retain both exact keys with your recovery material until rotation and normal app startup succeed. Use your platform's complete database-backup method if you do not use Compose.

   Run all Compose commands below from your existing Compose project directory containing `.env` and the Compose files. Source-checkout users first run `cd deploy/docker` from the repository root. Include every override file and any project-name option used by the installation in every command so the rotation tool selects the same backend and volumes as the app.

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

   For the bundled PostgreSQL Compose stack:

   ```sh
   docker compose -f docker-compose.yml run --rm --no-deps \
     --env-from-file "$HOME/.config/digarr/rotation/primary.env" \
     --entrypoint bun app \
     dist/scripts/rotate-encryption-key.js
   ```

   For the embedded-PGlite Compose stack, use the PGlite file so the one-off
   container mounts the same `/app/data` volume:

   ```sh
   docker compose -f docker-compose.pglite.yml run --rm --no-deps \
     --env-from-file "$HOME/.config/digarr/rotation/primary.env" \
     --entrypoint bun app \
     dist/scripts/rotate-encryption-key.js
   ```

   From the repository root of a source checkout at the same revision, run `bun scripts/rotate-encryption-key.ts` instead.
   Select the same backend as the app with `DATABASE_URL` for a
   PostgreSQL server or `DB_PATH` for embedded PGlite, and load the keys from a
   protected environment file rather than placing them on the command line.

   The script reads registered `enc:v1:` values, decrypts through the
   primary/next/legacy chain, and re-encrypts under the primary (new key).
   Safe to repeat: plaintext semantics are preserved even though every pass
   emits fresh ciphertext with a new IV. It exits nonzero if any encrypted
   value cannot be rewritten. Do not continue while the output contains a
   `skip` line or reports an incomplete rotation.

5. **Verify registered encrypted values using only the new key.** Leave every app
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
   checks registered encrypted values, including notification channels, but excludes per-user preferences as noted above. It re-encrypts
   them with fresh IVs and exits nonzero if any value still requires the old key.

6. **Restart with both keys and re-save excluded credentials.** After both script passes succeed, restart the app with the new key as primary and the old key as NEXT:

   ```dotenv
   DIGARR_ENCRYPTION_KEY=<new>
   DIGARR_ENCRYPTION_KEY_NEXT=<old>
   ```

   Have affected users re-enter and save excluded per-user credentials, including `users.preferences.fanartApiKey`. Supply the actual value; a masked placeholder can preserve the old ciphertext. These writes now use the new primary key.

7. **Verify the running app with only the new key.** During a controlled maintenance window, restart with the new primary and NEXT unset or explicitly empty. Independently exercise every encrypted storage site, including the excluded per-user preferences, service connections, OAuth refreshes, targets, and notification channels. The script alone cannot verify the excluded sites. Ensure pending provider connect attempts have completed or expired; restart unfinished attempts under the new key.

   If any credential fails or cannot be verified, restore the old key as NEXT and restart. Correct or re-save the affected value under the new primary, then repeat the new-key-only verification. Keep the runtime fallback until all sites have passed.

8. **Retire the runtime fallback after verification.** Keep NEXT unset after every storage site has passed the new-key-only check. Retain the old key securely offline with backups containing old or mixed ciphertext; removing the runtime fallback does not make those backups decryptable with the new key alone.

   Delete the temporary key files after the deployment succeeds:

   ```sh
   rm "$HOME/.config/digarr/rotation/primary.env" \
     "$HOME/.config/digarr/rotation/verify.env"
   rmdir "$HOME/.config/digarr/rotation"
   ```

## Rollback

Before the primary swap in step 3, reverting to the old primary is sufficient. Once step 3 has allowed writes, rollback must set the old key as primary **and the new key as `DIGARR_ENCRYPTION_KEY_NEXT`** so both ciphertext generations remain readable. Keep both keys until reverse re-encryption or a compatible backup restore is verified. If step 4 starts and then fails, keep both keys configured: rotation is
row-by-row, so the database may contain ciphertext written by either key. Fix
the reported rows and rerun step 4, or restore the pre-rotation backup. Do not
remove either runtime key until the script checks in step 5 and the running-app checks in step 7 succeed.

After step 8, reverse rotation is possible if both keys are retained: configure the old key as primary and the new key as fallback, then repeat re-encryption and verify the excluded storage sites. If the required key is unavailable or the data cannot be repaired, restore a compatible complete database backup. See [recovery boundaries](../guides/switching-backends.md#backup-boundaries-and-recovery) and [application restore](../OPERATIONS.md#backup--restore).
