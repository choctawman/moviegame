#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

source "./scripts/macos-common.sh"

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
  cp .env.example .env
  echo "Created .env from .env.example."
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
