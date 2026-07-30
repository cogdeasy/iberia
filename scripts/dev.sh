#!/usr/bin/env bash
# Start the Iberia backend and frontend together, in the order declared in the Procfile.
#
#   ./scripts/dev.sh
#
# Backend JSON logs are teed into logs/backend.log so Promtail (ops/) can ship them to Loki.
# Ctrl-C stops both processes.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT="${IBERIA_BACKEND_PORT:-8000}"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

if [[ ! -x backend/.venv/bin/uvicorn ]]; then
  echo "backend venv missing — run 'make setup' first" >&2
  exit 1
fi
if [[ ! -d frontend/node_modules ]]; then
  echo "frontend deps missing — run 'make setup' first" >&2
  exit 1
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "→ backend  http://127.0.0.1:${BACKEND_PORT}  (logs: logs/backend.log)"
(
  cd backend
  .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" 2>&1 |
    tee -a "$LOG_DIR/backend.log"
) &
pids+=("$!")

echo "→ frontend http://localhost:5173"
(
  cd frontend
  npm run dev 2>&1 | tee -a "$LOG_DIR/frontend.log"
) &
pids+=("$!")

wait -n
echo "one process exited — shutting the other down" >&2
