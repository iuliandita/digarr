CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" numeric(10, 4) NOT NULL,
	"last_refill_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "description" jsonb;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "external_links" jsonb;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "wikidata_id" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "wikidata_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "wikidata_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "audiodb_api_key" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "audiodb_proxy_images" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "wikidata_enabled" boolean DEFAULT true NOT NULL;
