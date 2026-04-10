CREATE TABLE IF NOT EXISTS "genres" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"source" text NOT NULL,
	"parent_genre_id" integer,
	"artist_count" integer DEFAULT 0,
	"cached_at" timestamp with time zone,
	CONSTRAINT "genres_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"artists_found" integer DEFAULT 0,
	"artists_new" integer DEFAULT 0,
	"error" text,
	"batch_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"source_type" text NOT NULL,
	"source_provider" text NOT NULL,
	"source_config" jsonb NOT NULL,
	"max_artists_per_run" integer DEFAULT 20 NOT NULL,
	"listener_range" jsonb,
	"cron" text NOT NULL,
	"action" text DEFAULT 'add_to_recommendations' NOT NULL,
	"score_threshold" real,
	"scoring_weight_preset" text DEFAULT 'default',
	"scoring_weight_overrides" jsonb,
	"last_run_at" timestamp with time zone,
	"last_result_count" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendation_batches" ADD COLUMN IF NOT EXISTS "subscription_id" integer;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'genres_parent_genre_id_genres_id_fk'
	) THEN
		ALTER TABLE "genres" ADD CONSTRAINT "genres_parent_genre_id_genres_id_fk" FOREIGN KEY ("parent_genre_id") REFERENCES "public"."genres"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'subscription_runs_subscription_id_subscriptions_id_fk'
	) THEN
		ALTER TABLE "subscription_runs" ADD CONSTRAINT "subscription_runs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'subscription_runs_batch_id_recommendation_batches_id_fk'
	) THEN
		ALTER TABLE "subscription_runs" ADD CONSTRAINT "subscription_runs_batch_id_recommendation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recommendation_batches"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_users_id_fk'
	) THEN
		ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_batches_subscription_id_subscriptions_id_fk'
	) THEN
		ALTER TABLE "recommendation_batches" ADD CONSTRAINT "recommendation_batches_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
