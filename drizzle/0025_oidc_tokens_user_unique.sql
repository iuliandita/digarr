-- Enforce one-session-per-user for OIDC tokens. Required by the new
-- upsertOidcTokens() helper which uses ON CONFLICT (user_id). The table
-- has no current writers, so pre-existing duplicates are not expected,
-- but we guard idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oidc_tokens_user_id_unique'
  ) THEN
    ALTER TABLE "oidc_tokens" ADD CONSTRAINT "oidc_tokens_user_id_unique" UNIQUE ("user_id");
  END IF;
END $$;
