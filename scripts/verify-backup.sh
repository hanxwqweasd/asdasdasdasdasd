#!/bin/sh
set -eu
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must point to an empty disposable PostgreSQL database}"
file="${1:?Usage: TEST_DATABASE_URL=... ./scripts/verify-backup.sh backup.dump}"
[ -f "$file" ] || { echo "Backup not found: $file" >&2; exit 2; }
pg_restore --dbname="$TEST_DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$file"
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN RAISE EXCEPTION 'users table missing'; END IF;
  IF to_regclass('public.purchases') IS NULL THEN RAISE EXCEPTION 'purchases table missing'; END IF;
  IF to_regclass('public.inventory') IS NULL THEN RAISE EXCEPTION 'inventory table missing'; END IF;
END $$;
SELECT COUNT(*) AS restored_users FROM users;
SELECT COUNT(*) AS restored_purchases FROM purchases;
SQL
echo "Backup restore verification passed"
