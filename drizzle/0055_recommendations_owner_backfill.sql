-- Legacy recommendations without an owner belong to the first admin (or the first user when no admin exists).
UPDATE "recommendations"
SET "user_id" = (SELECT "id" FROM "users" ORDER BY "is_admin" DESC, "id" ASC LIMIT 1)
WHERE "user_id" IS NULL;
