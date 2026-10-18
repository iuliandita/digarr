UPDATE "playlists" SET "schedule" = NULL, "enabled" = true WHERE "enabled" = false AND "schedule" IS NOT NULL;
