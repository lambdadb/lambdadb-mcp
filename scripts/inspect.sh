#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# Load credentials in the server process, not in Inspector command-line arguments.
exec npx @modelcontextprotocol/inspector bash ./scripts/with-env.sh dist/index.js
