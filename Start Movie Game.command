#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

source "./scripts/macos-common.sh"
source "./scripts/shared-db-snapshot.sh"

wait_for_http() {
  local url="$1"
  local attempts="${2:-60}"
  local i=0

  while [ "$i" -lt "$attempts" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
    i=$((i + 1))
  done

  return 1
}

wait_for_postgres() {
  local attempts="${1:-60}"
  local i=0

  while [ "$i" -lt "$attempts" ]; do
    if pg_isready -q; then
      return 0
    fi

    sleep 1
    i=$((i + 1))
  done

  return 1
}

wait_for_redis() {
  local attempts="${1:-60}"
  local i=0

  while [ "$i" -lt "$attempts" ]; do
    if redis-cli ping >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
    i=$((i + 1))
  done

  return 1
}

stop_existing_processes() {
  if [ -f .logs/web.pid ]; then
    kill "$(cat .logs/web.pid)" 2>/dev/null || true
    rm -f .logs/web.pid
  fi

  if [ -f .logs/worker.pid ]; then
    kill "$(cat .logs/worker.pid)" 2>/dev/null || true
    rm -f .logs/worker.pid
  fi
}

ensure_macos
ensure_log_dir
ensure_xcode_clt
ensure_homebrew
setup_runtime_path

if [ ! -f .env ] || [ ! -d node_modules ]; then
  echo "This copy is not installed yet."
  echo "Running Install Movie Game.command first..."
  ./Install\ Movie\ Game.command
  exit 0
fi

load_project_env

print_divider
echo "Starting local services..."
brew services start postgresql@16 >/dev/null 2>&1 || true
brew services start redis >/dev/null 2>&1 || true

if ! wait_for_postgres; then
  echo "PostgreSQL did not become ready in time."
  echo "Check Homebrew services and try again."
  exit 1
fi

if ! wait_for_redis; then
  echo "Redis did not become ready in time."
  echo "Check Homebrew services and try again."
  exit 1
fi

print_divider
echo "Preparing the app..."
psql -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'moviegame') THEN
    CREATE ROLE moviegame LOGIN PASSWORD 'moviegame';
  END IF;
END
$$;
SQL

createdb -O moviegame moviegame 2>/dev/null || true
psql -d postgres -c "ALTER ROLE moviegame CREATEDB;" >/dev/null 2>&1 || true
psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE moviegame TO moviegame;" >/dev/null 2>&1 || true

npx prisma migrate deploy >/dev/null
npm run prisma:generate >/dev/null
restore_shared_snapshot_if_needed
npm run seed >/dev/null
npm run build >/dev/null

stop_existing_processes

print_divider
echo "Launching Movie Game..."
nohup env PATH="$PATH" npx tsx server.ts > .logs/web.log 2>&1 &
echo $! > .logs/web.pid

nohup env PATH="$PATH" npx tsx src/server/worker.ts > .logs/worker.log 2>&1 &
echo $! > .logs/worker.pid

if wait_for_http "http://127.0.0.1:3000"; then
  open "http://localhost:3000"
  echo "Movie Game is running."
else
  echo "Movie Game was started, but the web server did not answer yet."
  echo "Check the logs below if the browser does not load."
fi

echo "URL: http://localhost:3000"
echo "Commissioner login: commissioner@example.com / password123"
echo "Web log: $(pwd)/.logs/web.log"
echo "Worker log: $(pwd)/.logs/worker.log"
