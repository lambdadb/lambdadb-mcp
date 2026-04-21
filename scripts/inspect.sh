#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Create it first with: cp .env.example .env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${LAMBDADB_BASE_URL:?Missing LAMBDADB_BASE_URL in .env}"
: "${LAMBDADB_PROJECT_NAME:?Missing LAMBDADB_PROJECT_NAME in .env}"
: "${LAMBDADB_PROJECT_API_KEY:?Missing LAMBDADB_PROJECT_API_KEY in .env}"

if [[ -n "${LAMBDADB_MCP_ENABLE_WRITE_TOOLS:-}" ]]; then
  WRITE_TOOL_ENV=(-e "LAMBDADB_MCP_ENABLE_WRITE_TOOLS=${LAMBDADB_MCP_ENABLE_WRITE_TOOLS}")
else
  WRITE_TOOL_ENV=()
fi

cd "${ROOT_DIR}"

exec npx @modelcontextprotocol/inspector \
  -e "LAMBDADB_BASE_URL=${LAMBDADB_BASE_URL}" \
  -e "LAMBDADB_PROJECT_NAME=${LAMBDADB_PROJECT_NAME}" \
  -e "LAMBDADB_PROJECT_API_KEY=${LAMBDADB_PROJECT_API_KEY}" \
  "${WRITE_TOOL_ENV[@]}" \
  node dist/index.js

