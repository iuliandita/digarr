-- Enforce at-most-one admin user via a unique partial index. This is the
-- DB-level guarantee that the first-admin bootstrap race (two concurrent
-- setup/register requests both seeing userCount=0) cannot produce two
-- admins. Application code catches the 23505 collision and resolves the
-- loser to the winning admin row.
--
-- If the DB already contains multiple admins (from a prior race, or from
-- intentional multi-admin state), we keep the OLDEST admin and demote the
-- rest to regular users. Operators can re-promote demoted users manually
-- via the admin UI after review. The demotion is logged via RAISE NOTICE
-- so it surfaces in migration output instead of failing the deploy.
DO $$
DECLARE
  kept_admin_id integer;
  demoted_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'users_single_admin'
  ) THEN
    SELECT id INTO kept_admin_id
      FROM users WHERE is_admin = true
      ORDER BY id ASC
      LIMIT 1;

    IF kept_admin_id IS NOT NULL THEN
      UPDATE users SET is_admin = false
        WHERE is_admin = true AND id <> kept_admin_id;
      GET DIAGNOSTICS demoted_count = ROW_COUNT;

      IF demoted_count > 0 THEN
        RAISE NOTICE 'Migration 0026: demoted % extra admin(s) to satisfy users_single_admin unique index (kept user id=%). Re-promote manually after review.',
          demoted_count, kept_admin_id;
      END IF;
    END IF;

    CREATE UNIQUE INDEX users_single_admin
      ON users (is_admin) WHERE is_admin = true;
  END IF;
END $$;
