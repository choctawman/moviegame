#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

source "./scripts/macos-common.sh"
source "./scripts/shared-db-snapshot.sh"

ensure_macos
ensure_homebrew
setup_runtime_path

set -a
source .env
set +a

print_divider
echo "Exporting the current Postgres data into the bundled shared snapshot..."
export_shared_snapshot

print_divider
echo "Snapshot updated:"
echo "$SHARED_DB_SNAPSHOT_PATH"
echo
echo "Fresh installs will restore this snapshot automatically."
