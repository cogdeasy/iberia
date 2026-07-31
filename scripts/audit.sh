#!/usr/bin/env bash
# Dependency CVE scan for both halves of the monorepo.
#
#   ./scripts/audit.sh            # human-readable summary
#   ./scripts/audit.sh --json     # machine-readable, for CI or a Devin session
#
# Backend: pip-audit against the OSV/PyPI advisory database.
# Frontend: npm audit against the GitHub advisory database.
#
# Known planted findings are documented in docs/vulnerabilities/ (VULN-152 Python,
# VULN-165 Node). The demo run-of-show is docs/demo/CVE-REMEDIATION.md.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JSON=0
[[ "${1:-}" == "--json" ]] && JSON=1

PY="$ROOT/backend/.venv/bin/python"
[[ -x "$PY" ]] || PY="$(command -v python3)"

echo "== backend (pip-audit) =="
if "$PY" -m pip_audit --version >/dev/null 2>&1; then
  if [[ $JSON -eq 1 ]]; then
    (cd "$ROOT/backend" && "$PY" -m pip_audit -r requirements.txt --format json)
  else
    (cd "$ROOT/backend" && "$PY" -m pip_audit -r requirements.txt)
  fi
else
  echo "pip-audit not installed — run: backend/.venv/bin/pip install -r backend/requirements-dev.txt"
fi

echo
echo "== frontend (npm audit) =="
if [[ $JSON -eq 1 ]]; then
  (cd "$ROOT/frontend" && npm audit --json)
else
  (cd "$ROOT/frontend" && npm audit)
fi
