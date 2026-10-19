UPDATE "artists" SET "image_url" = regexp_replace("image_url", '^http://', 'https://', 'i') WHERE "image_url" ~* '^http://(assets\.fanart\.tv|(www\.|r2\.|img\.)?theaudiodb\.com)/';--> statement-breakpoint
UPDATE "artists" SET "logo_url" = regexp_replace("logo_url", '^http://', 'https://', 'i') WHERE "logo_url" ~* '^http://(assets\.fanart\.tv|(www\.|r2\.|img\.)?theaudiodb\.com)/';
