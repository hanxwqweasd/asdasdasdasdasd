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
pg_dump "$DATABASE_URL" --format=custom --compress=6 --no-owner --no-privileges --file="$tmp"
mv "$tmp" "$file"
sha256sum "$file" > "${file}.sha256"
find "$BACKUP_DIR" -type f \( -name '*.dump' -o -name '*.sha256' -o -name '*.jsonl' \) -mtime "+$RETENTION_DAYS" -delete
if [ -n "${BACKUP_WEBHOOK_URL:-}" ]; then
  curl --fail --silent --show-error -X PUT -H "content-type: application/octet-stream" --data-binary "@$file" "$BACKUP_WEBHOOK_URL?name=$(basename "$file")"
fi
printf '%s\n' "$file"
