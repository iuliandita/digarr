CREATE TABLE IF NOT EXISTS "library_health_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
