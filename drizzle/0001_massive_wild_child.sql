ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "skip_tls_verify" boolean DEFAULT false NOT NULL;
