#!/usr/bin/env sh
# Pi Setup installer for macOS and Linux.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required. Install Node.js 20 or newer, then run this installer again."
}

require_command node
require_command npm

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) ||
  fail "Node.js could not be started. Install Node.js 20 or newer, then run this installer again."

case "$node_major" in
  ''|*[!0-9]*) fail "Could not determine the Node.js version. Node.js 20 or newer is required." ;;
esac

[ "$node_major" -ge 20 ] ||
  fail "Node.js 20 or newer is required. Found Node.js $(node --version)."

printf '%s\n' "Installing Pi Setup from: $root"
exec node "$root/install.mjs" --replace
