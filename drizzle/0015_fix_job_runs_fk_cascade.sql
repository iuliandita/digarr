ALTER TABLE "job_runs" DROP CONSTRAINT IF EXISTS "job_runs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_runs" DROP CONSTRAINT IF EXISTS "job_runs_subscription_id_subscriptions_id_fk";
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_runs" DROP CONSTRAINT IF EXISTS "job_runs_batch_id_recommendation_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_batch_id_recommendation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."recommendation_batches"("id") ON DELETE set null ON UPDATE no action;
