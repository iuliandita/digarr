ALTER TABLE "recommendation_batches" DROP CONSTRAINT IF EXISTS "recommendation_batches_subscription_id_subscriptions_id_fk";
--> statement-breakpoint
ALTER TABLE "recommendations" DROP CONSTRAINT IF EXISTS "recommendations_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "recommendation_batches" ADD CONSTRAINT "recommendation_batches_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;