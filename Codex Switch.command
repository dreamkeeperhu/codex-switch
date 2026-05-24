#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-38383}"
URL="http://127.0.0.1:${PORT}"

if command -v curl >/dev/null 2>&1 && curl -fsS "${URL}/api/status" >/dev/null 2>&1; then
  open "${URL}"
  exit 0
fi

(
  for _ in {1..40}; do
    if command -v curl >/dev/null 2>&1 && curl -fsS "${URL}/api/status" >/dev/null 2>&1; then
      open "${URL}"
      exit 0
    fi
    sleep 0.25
  done
) &

PORT="${PORT}" node server.js
