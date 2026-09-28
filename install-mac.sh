#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Use install-windows.ps1 on Windows. This installer supports macOS."
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js 22.13 or newer from https://nodejs.org, then rerun this installer."
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) { console.error("Node.js 22.13 or newer is required."); process.exit(1); }'
npm --prefix agent ci
node agent/cli.mjs setup
node agent/cli.mjs schedule
