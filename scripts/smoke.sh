#!/usr/bin/env bash
# Curl-based smoke test for a locally running Iberia backend.
#
#   ./scripts/smoke.sh [base-url]        # default http://127.0.0.1:8000
#
# Endpoints owned by workstreams that are not merged yet return 404; those are reported as
# SKIP, not FAIL, so this script is safe to run against a partially assembled estate.
set -uo pipefail

BASE="${1:-${IBERIA_BASE_URL:-http://127.0.0.1:8000}}"
pass=0
fail=0
skip=0

green() { printf '\033[32m%s\033[0m' "$1"; }
red() { printf '\033[31m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }

# check <label> <path> <expected-substring>
check() {
  local label="$1" path="$2" expect="$3"
  local body status
  body="$(curl -sS -m 10 -w $'\n%{http_code}' "${BASE}${path}" 2>/dev/null)" || {
    printf '%s  %-34s %s\n' "$(red FAIL)" "$label" "connection error ($path)"
    fail=$((fail + 1))
    return
  }
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"

  if [[ "$status" == "404" ]]; then
    printf '%s  %-34s %s\n' "$(yellow SKIP)" "$label" "404 — domain not merged yet ($path)"
    skip=$((skip + 1))
    return
  fi
  if [[ "$status" != "200" ]]; then
    printf '%s  %-34s %s\n' "$(red FAIL)" "$label" "HTTP $status ($path)"
    fail=$((fail + 1))
    return
  fi
  if [[ -n "$expect" && "$body" != *"$expect"* ]]; then
    printf '%s  %-34s %s\n' "$(red FAIL)" "$label" "200 but missing '$expect' ($path)"
    fail=$((fail + 1))
    return
  fi
  printf '%s  %-34s %s\n' "$(green PASS)" "$label" "200 ($path)"
  pass=$((pass + 1))
}

echo "Iberia smoke test → ${BASE}"
echo

check "liveness"          "/healthz"              '"status":"ok"'
check "readiness"         "/readyz"               'reachable'
check "prometheus metrics" "/metrics"             'iberia_http_requests_total'
check "flights: airports" "/api/flights/airports" ''

echo
printf 'passed %d, failed %d, skipped %d\n' "$pass" "$fail" "$skip"
[[ "$fail" -eq 0 ]] || exit 1
