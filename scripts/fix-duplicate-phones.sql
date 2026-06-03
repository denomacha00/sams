-- Manual cleanup: normalize User phones, dedupe per school, add partial unique index.
-- Safe to re-run (idempotent). Run before migrate deploy if DB still has duplicate phones.
--
-- Usage:
--   cd /var/www/sams/packages/backend
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ../../scripts/fix-duplicate-phones.sql
--
-- Or: bash /var/www/sams/scripts/fix-duplicate-phones.sh

\echo '==> Duplicate (schoolId, phone) groups BEFORE fix'
SELECT "schoolId", phone, COUNT(*) AS cnt,
       array_agg(id ORDER BY "createdAt" ASC) AS user_ids,
       MIN("createdAt") AS oldest_created
FROM "User"
WHERE phone IS NOT NULL
GROUP BY "schoolId", phone
HAVING COUNT(*) > 1
ORDER BY cnt DESC;

CREATE OR REPLACE FUNCTION sams_normalize_kenya_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    ELSE (
      WITH d AS (SELECT regexp_replace(p, '\D', '', 'g') AS digits)
      SELECT CASE
        WHEN (SELECT digits FROM d) LIKE '254%' THEN '+' || (SELECT digits FROM d)
        WHEN (SELECT digits FROM d) LIKE '0%' AND length((SELECT digits FROM d)) = 10
          THEN '+254' || substr((SELECT digits FROM d), 2)
        WHEN length((SELECT digits FROM d)) = 9
          THEN '+254' || (SELECT digits FROM d)
        WHEN p LIKE '+%' THEN p
        ELSE '+' || (SELECT digits FROM d)
      END
    )
  END;
$$;

\echo '==> Normalizing phones (Kenya E.164, same as normalizeSmsPhone)'
UPDATE "User"
SET phone = sams_normalize_kenya_phone(phone)
WHERE phone IS NOT NULL
  AND phone IS DISTINCT FROM sams_normalize_kenya_phone(phone);

\echo '==> Clearing phone on duplicate accounts (keeps oldest per schoolId+phone)'
WITH ranked AS (
  SELECT
    id,
    "schoolId",
    phone,
    "createdAt",
    ROW_NUMBER() OVER (
      PARTITION BY "schoolId", phone
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "User"
  WHERE phone IS NOT NULL
),
dupes AS (
  SELECT id, "schoolId", phone, "createdAt"
  FROM ranked
  WHERE rn > 1
)
UPDATE "User" u
SET phone = NULL
FROM dupes d
WHERE u.id = d.id;

DROP FUNCTION IF EXISTS sams_normalize_kenya_phone(text);

\echo '==> Remaining duplicate groups (should be empty)'
SELECT "schoolId", phone, COUNT(*) AS cnt
FROM "User"
WHERE phone IS NOT NULL
GROUP BY "schoolId", phone
HAVING COUNT(*) > 1;

\echo '==> Creating partial unique index if missing'
CREATE UNIQUE INDEX IF NOT EXISTS "User_schoolId_phone_key"
  ON "User"("schoolId", "phone")
  WHERE "phone" IS NOT NULL;

\echo '==> Done'
