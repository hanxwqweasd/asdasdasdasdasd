#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
kind="${1:-daily}"
file="$BACKUP_DIR/eighth-floor-${kind}-${ts}.dump"
tmp="${file}.part"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
client_version="$($PG_DUMP_BIN --version | awk '{print $3}')"
client_major="${client_version%%.*}"
server_version_num="$(psql "$DATABASE_URL" -Atqc 'SHOW server_version_num')"
server_major="$((server_version_num / 10000))"
if [ "$client_major" -lt "$server_major" ]; then
  echo "pg_dump client $client_version is older than PostgreSQL server major $server_major" >&2
  exit 42
fi
"$PG_DUMP_BIN" "$DATABASE_URL" --format=custom --compress=6 --no-owner --no-privileges --file="$tmp"
mv "$tmp" "$file"
sha256sum "$file" > "${file}.sha256"
find "$BACKUP_DIR" -type f \( -name '*.dump' -o -name '*.sha256' -o -name '*.jsonl' \) -mtime "+$RETENTION_DAYS" -delete
if [ -n "${BACKUP_WEBHOOK_URL:-}" ]; then
  curl --fail --silent --show-error -X PUT -H "content-type: application/octet-stream" --data-binary "@$file" "$BACKUP_WEBHOOK_URL?name=$(basename "$file")"
fi
printf '%s\n' "$file"
