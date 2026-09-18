WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY work_key
      ORDER BY (state = 'failed') ASC, updated_at DESC, id DESC
    ) AS position,
    count(*) OVER (PARTITION BY work_key) AS copies,
    sum(greatest(attempts, CASE WHEN state = 'failed' THEN 1 ELSE 0 END))
      OVER (PARTITION BY work_key) AS total_attempts
  FROM slskd_jobs
  WHERE state IN ('pending', 'searching', 'queued', 'downloading', 'import_pending', 'failed')
)
UPDATE slskd_jobs AS jobs
SET state = CASE WHEN ranked.position = 1 THEN jobs.state ELSE 'superseded' END,
    attempts = CASE WHEN ranked.position = 1
      THEN least(ranked.total_attempts, 2147483647)::integer ELSE jobs.attempts END
FROM ranked
WHERE jobs.id = ranked.id AND ranked.copies > 1;
