#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
file="${1:?Usage: RESTORE_CONFIRM=YES ./scripts/restore.sh backup.dump}"
[ -f "$file" ] || { echo "Backup not found: $file" >&2; exit 2; }
[ "${RESTORE_CONFIRM:-}" = "YES" ] || { echo "Set RESTORE_CONFIRM=YES to restore" >&2; exit 3; }
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$file"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS users FROM users; SELECT COUNT(*) AS purchases FROM purchases;"
