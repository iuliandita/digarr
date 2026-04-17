-- Enforce at-most-one admin user via a unique partial index. This is the
-- DB-level guarantee that the first-admin bootstrap race (two concurrent
-- setup/register requests both seeing userCount=0) cannot produce two
-- admins. Application code catches the 23505 collision and resolves the
-- loser to the winning admin row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'users_single_admin'
  ) THEN
    CREATE UNIQUE INDEX users_single_admin
      ON users (is_admin) WHERE is_admin = true;
  END IF;
END $$;
