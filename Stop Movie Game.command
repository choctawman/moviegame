#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [ -f .logs/web.pid ]; then
  kill "$(cat .logs/web.pid)" 2>/dev/null || true
  rm -f .logs/web.pid
fi

if [ -f .logs/worker.pid ]; then
  kill "$(cat .logs/worker.pid)" 2>/dev/null || true
  rm -f .logs/worker.pid
fi

echo "Movie Game processes stopped."
