#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -n "${LAMBDADB_ENV_FILE:-}" ]]; then
  ENV_FILE="${LAMBDADB_ENV_FILE}"
elif [[ -f .env.local ]]; then
  ENV_FILE=.env.local
else
  ENV_FILE=.env
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing environment file: ${ENV_FILE}. Copy .env.example to .env.local or set LAMBDADB_ENV_FILE." >&2
  exit 1
fi

# Let Node parse dotenv values as data, without shell expansion. Exported variables win.
exec node --env-file="${ENV_FILE}" "$@"
