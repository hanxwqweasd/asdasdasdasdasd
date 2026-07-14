#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
out="${1:-/backups/export-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$out"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "\copy (SELECT u.id,u.username,u.first_name,u.created_at,p.apartment_no,p.trust,p.clues,p.house_marks,p.stars_spent FROM users u JOIN player_profiles p ON p.user_id=u.id WHERE u.id>0) TO '$out/users.csv' CSV HEADER"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "\copy (SELECT id,user_id,sku,stars,status,created_at,fulfilled_at FROM purchases) TO '$out/purchases.csv' CSV HEADER"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "\copy (SELECT user_id,item_id,quantity,metadata FROM inventory WHERE quantity>0) TO '$out/inventory.csv' CSV HEADER"
sha256sum "$out"/*.csv > "$out/SHA256SUMS"
echo "$out"
