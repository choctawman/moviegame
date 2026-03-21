#!/bin/bash

set -euo pipefail

SHARED_DATA_DIR="$PROJECT_DIR/shared-data"
SHARED_DB_SNAPSHOT_PATH="$SHARED_DATA_DIR/postgres/current-data.sql.gz"
SHARED_LOGIN_MANIFEST_PATH="$SHARED_DATA_DIR/login-manifest.json"

database_url_base() {
  echo "${DATABASE_URL%%\?*}"
}

shared_snapshot_exists() {
  [ -f "$SHARED_DB_SNAPSHOT_PATH" ]
}

shared_login_manifest_exists() {
  [ -f "$SHARED_LOGIN_MANIFEST_PATH" ]
}

league_count() {
  local db_base_url
  db_base_url="$(database_url_base)"
  psql "$db_base_url" -Atqc 'select count(*) from "League";'
}

restore_shared_snapshot_if_needed() {
  if ! shared_snapshot_exists; then
    return
  fi

  if [ "$(league_count)" != "0" ]; then
    return
  fi

  print_divider
  echo "Restoring bundled shared league snapshot..."
  gunzip -c "$SHARED_DB_SNAPSHOT_PATH" | psql "$(database_url_base)" -v ON_ERROR_STOP=1

  if shared_login_manifest_exists; then
    echo "Applying bundled tester login passwords..."
    npx tsx src/scripts/apply-shared-login-passwords.ts >/dev/null
  fi
}

export_shared_snapshot() {
  mkdir -p "$(dirname "$SHARED_DB_SNAPSHOT_PATH")"
  pg_dump \
    --data-only \
    --inserts \
    --no-owner \
    --no-privileges \
    "$(database_url_base)" | gzip -c > "$SHARED_DB_SNAPSHOT_PATH"
}
