#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# Inspector sanitizes the child environment. Forward only these non-secret overrides.
INSPECTOR_ENV=()
for name in LAMBDADB_ENV_FILE LAMBDADB_MCP_ENABLE_WRITE_TOOLS; do
  if [[ -n "${!name:-}" ]]; then
    INSPECTOR_ENV+=(-e "${name}=${!name}")
  fi
done

# Inspector's mode flag precedes the server command; method options follow it.
INSPECTOR_MODE=()
if [[ "${1:-}" == "--cli" ]]; then
  INSPECTOR_MODE=(--cli)
  shift
fi

# Load credentials in the server process, not in Inspector command-line arguments.
exec npx @modelcontextprotocol/inspector "${INSPECTOR_MODE[@]}" bash ./scripts/with-env.sh dist/index.js "${INSPECTOR_ENV[@]}" "$@"
