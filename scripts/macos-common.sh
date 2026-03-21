#!/bin/bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/.logs"

have_command() {
  command -v "$1" >/dev/null 2>&1
}

ensure_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "This installer is currently for macOS only."
    exit 1
  fi
}

find_brew_bin() {
  if [ -x /opt/homebrew/bin/brew ]; then
    echo /opt/homebrew/bin/brew
    return
  fi

  if [ -x /usr/local/bin/brew ]; then
    echo /usr/local/bin/brew
    return
  fi

  if have_command brew; then
    command -v brew
    return
  fi

  return 1
}

ensure_xcode_clt() {
  if xcode-select -p >/dev/null 2>&1; then
    return
  fi

  echo "Apple Command Line Tools are required the first time."
  echo "macOS will open Apple's installer now."
  xcode-select --install || true
  echo
  echo "Finish that installer, then double-click this file again."
  exit 0
}

ensure_homebrew() {
  if BREW_BIN="$(find_brew_bin 2>/dev/null)"; then
    export BREW_BIN
    return
  fi

  echo "Homebrew is required and is not installed yet."
  echo "Starting the Homebrew installer in this Terminal window."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  BREW_BIN="$(find_brew_bin)"
  export BREW_BIN
}

load_brew_environment() {
  eval "$("$BREW_BIN" shellenv)"
}

prepend_formula_bin() {
  local formula="$1"
  local prefix=""

  prefix="$("$BREW_BIN" --prefix "$formula" 2>/dev/null || true)"
  if [ -n "$prefix" ]; then
    export PATH="$prefix/bin:$prefix/sbin:$PATH"
  fi
}

setup_runtime_path() {
  load_brew_environment
  prepend_formula_bin node@22
  prepend_formula_bin postgresql@16
  prepend_formula_bin redis
}

ensure_log_dir() {
  mkdir -p "$LOG_DIR"
}

print_divider() {
  printf '\n%s\n\n' "------------------------------------------------------------"
}
