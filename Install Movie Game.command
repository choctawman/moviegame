#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

source "./scripts/macos-common.sh"
source "./scripts/shared-db-snapshot.sh"

write_default_env() {
  cat > .env <<'EOF'
DATABASE_URL="postgresql://moviegame:moviegame@localhost:5432/moviegame?schema=public"
REDIS_URL="redis://localhost:6379"
SESSION_COOKIE_NAME="movie_game_session"
SESSION_TTL_DAYS="14"
APP_URL="http://localhost:3000"
TMDB_API_KEY=""
TMDB_BASE_URL="https://api.themoviedb.org/3"
TMDB_DISCOVER_MAX_PAGES="100"
TMDB_REQUEST_DELAY_MS="120"
TMDB_REGION="US"
TMDB_ORIGIN_COUNTRY="US"
TMDB_MIN_RUNTIME_MINUTES="70"
TMDB_ORIGINAL_LANGUAGE="en"
TMDB_RELEASE_TYPES="2|3"
RT_SCRAPE_BASE_URL="https://www.rottentomatoes.com"
BOXOFFICE_BASE_URL="https://www.the-numbers.com"
PROVIDER_CACHE_TTL_SECONDS="21600"
PROVIDER_RATE_LIMIT_MIN_TIME_MS="500"
EOF
}

ensure_macos
ensure_log_dir
ensure_xcode_clt
ensure_homebrew
setup_runtime_path

print_divider
echo "Installing system dependencies with Homebrew..."
brew install node@22 postgresql@16 redis

print_divider
echo "Preparing project files..."

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example."
  else
    write_default_env
    echo "Created .env from built-in defaults."
  fi
fi

echo "Installing npm packages..."
npm install

print_divider
echo "Install complete."
echo
echo "The game will start now."
echo "Later, you can just double-click Start Movie Game.command."
echo

./Start\ Movie\ Game.command
