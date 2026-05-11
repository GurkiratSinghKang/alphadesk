#!/usr/bin/env bash
# Post-merge smoke test for audit 2026-05-11 fix-loop work.
#
# Run after deploying `claude/focused-shirley-206414` (or its
# merged downstream branch) to verify the security / compliance
# / contract fixes are actually live in production. Each check
# maps to a BUG-NNN.
#
# Usage:
#   ALPHADESK_TEST_PASS=<hash> ./.audit/2026-05-11/post-merge-smoke.sh
#   ALPHADESK_TEST_PASS=<hash> ./.audit/2026-05-11/post-merge-smoke.sh https://staging.tradingalpha.net
#
# Exits non-zero if any check fails. Each FAIL line names the BUG
# whose fix regressed.

set -uo pipefail

BASE_URL="${1:-https://tradingalpha.net}"
COOKIE=$(mktemp -t alphadesk-smoke.XXXXXX)
trap 'rm -f "$COOKIE"' EXIT

ADMIN_USER="${ALPHADESK_TEST_USER:-admin}"
ADMIN_PASS="${ALPHADESK_TEST_PASS:?ALPHADESK_TEST_PASS must be set in env}"

PASS=0
FAIL=0
SKIPPED=0

ok()    { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
fail()  { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
skip()  { printf "  \033[33m~\033[0m %s\n" "$1"; SKIPPED=$((SKIPPED+1)); }
heading(){ printf "\n\033[1m%s\033[0m\n" "$1"; }


heading "===== Audit 2026-05-11 post-merge smoke ====="
echo "Target: $BASE_URL"
echo "User:   $ADMIN_USER"

# ─── Auth setup ───────────────────────────────────────────────────────

heading "Auth"
login_code=$(curl -sS -c "$COOKIE" -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -H "Origin: $BASE_URL" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  -o /dev/null -w "%{http_code}")
if [ "$login_code" = "200" ]; then
  ok "login as $ADMIN_USER returns 200"
else
  fail "login returned $login_code — cannot run authed checks (exiting)"
  exit 1
fi

# ─── BUG-064: API key redaction in logs ─────────────────────────────
heading "BUG-064 — log-formatter API-key redaction"
skip "log-side check (requires SSH to backend logs; covered by backend/core/tests/test_logging_redaction.py)"

# ─── BUG-065: demo state-picker gated to non-prod ───────────────────
heading "BUG-065 — DEMO state-picker chips not visible on prod /login"
login_html=$(curl -sSL "$BASE_URL/login")
if echo "$login_html" | grep -qE 'magic-sent.*twofa.*recovery'; then
  fail "DEMO STATE PICKER chips still rendered on /login (BUG-065 regressed)"
else
  ok "no DEMO state-picker chips on /login"
fi

# ─── BUG-067 (partial): CSP Report-Only header present ──────────────
heading "BUG-067 (partial) — strict CSP shipping as Report-Only"
csp_ro=$(curl -sSI "$BASE_URL/login" | grep -i '^content-security-policy-report-only:')
if [ -n "$csp_ro" ]; then
  if echo "$csp_ro" | grep -q "strict-dynamic"; then
    ok "Content-Security-Policy-Report-Only header present with 'strict-dynamic'"
  else
    fail "Report-Only header present but missing 'strict-dynamic' (BUG-067 partial regressed)"
  fi
else
  fail "Content-Security-Policy-Report-Only header missing (BUG-067 middleware not deployed)"
fi

# ─── BUG-077: CSRF Origin middleware ────────────────────────────────
heading "BUG-077 — CSRF Origin middleware rejects disallowed origins"
csrf_code=$(curl -sS -X POST "$BASE_URL/api/v1/trades/orders" \
  -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://evil.example' \
  -d '{}' -o /dev/null -w "%{http_code}")
if [ "$csrf_code" = "403" ]; then
  ok "POST with Origin: https://evil.example returns 403"
else
  fail "POST with disallowed Origin returned $csrf_code (expected 403; BUG-077 regressed)"
fi

# ─── BUG-058: review_id mandatory ───────────────────────────────────
heading "BUG-058 — POST /trades/orders requires review_id"
orders_code=$(curl -sS -X POST "$BASE_URL/api/v1/trades/orders" \
  -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  -H "Origin: $BASE_URL" \
  -d '{"legs":[{"symbol":"SPY","side":"buy","qty":1,"order_type":"market"}]}' \
  -o /tmp/smoke-orders.json -w "%{http_code}")
if [ "$orders_code" = "428" ]; then
  ok "bare POST /trades/orders returns 428 (Precondition Required)"
  if grep -q '"order_review_required"' /tmp/smoke-orders.json 2>/dev/null; then
    ok "error code is 'order_review_required'"
  else
    fail "428 returned but error code missing; check response shape"
  fi
elif [ "$orders_code" = "200" ] || [ "$orders_code" = "201" ]; then
  fail "BUG-058 REGRESSED — bare POST /trades/orders returned $orders_code; a live order may have fired!"
else
  fail "unexpected status $orders_code (expected 428)"
fi

# ─── BUG-088: support ticket intake works ───────────────────────────
heading "BUG-088 — POST /api/v1/support/tickets accepts a feedback body"
ticket_code=$(curl -sS -X POST "$BASE_URL/api/v1/support/tickets" \
  -b "$COOKIE" \
  -H 'Content-Type: application/json' \
  -H "Origin: $BASE_URL" \
  -d '{"category":"support","subject":"smoke-test","body":"audit 2026-05-11 post-merge smoke","page_url":"/smoke"}' \
  -o /tmp/smoke-ticket.json -w "%{http_code}")
if [ "$ticket_code" = "201" ]; then
  ok "support ticket POST returned 201"
  if grep -q '"ticket_id"' /tmp/smoke-ticket.json; then
    ok "response includes ticket_id field"
  else
    fail "response missing ticket_id field"
  fi
else
  fail "ticket POST returned $ticket_code (expected 201; BUG-088 regressed)"
fi

# ─── BUG-073: STProfile reads real /user/me ─────────────────────────
heading "BUG-073 — /api/v1/user/me returns real user data"
me_code=$(curl -sS -b "$COOKIE" "$BASE_URL/api/v1/user/me" -o /tmp/smoke-me.json -w "%{http_code}")
if [ "$me_code" = "200" ]; then
  if grep -q '"username"' /tmp/smoke-me.json; then
    ok "/api/v1/user/me returns 200 with username field"
  else
    fail "/api/v1/user/me 200 but no username — frontend STProfile will fall back to em-dash"
  fi
else
  fail "/api/v1/user/me returned $me_code"
fi

# ─── BUG-068: /welcome KPI strip is em-dashes by default ────────────
heading "BUG-068 — /welcome KPI strip shows em-dashes (no fabricated numbers)"
welcome_html=$(curl -sSL "$BASE_URL/welcome")
if echo "$welcome_html" | grep -qE 'OPERATORS.{0,1000}284'; then
  fail "BUG-068 REGRESSED — /welcome shows literal '284 OPERATORS' (securities marketing fraud risk)"
else
  ok "/welcome KPI strip does not advertise '284 OPERATORS'"
fi
if echo "$welcome_html" | grep -qE '\+18\.2%'; then
  fail "BUG-068 REGRESSED — /welcome shows literal '+18.2% YTD'"
else
  ok "/welcome no longer shows '+18.2% YTD' headline number"
fi

# ─── BUG-083: skip-to-content link ──────────────────────────────────
heading "BUG-083 — skip-to-content link present on public routes"
for path in "/login" "/about" "/pricing" "/welcome"; do
  body=$(curl -sSL "$BASE_URL$path")
  if echo "$body" | grep -q 'href="#main-content"'; then
    ok "$path has skip-to-content link to #main-content"
  else
    fail "$path missing skip-to-content link (BUG-083 regressed on this route)"
  fi
done

# ─── BUG-079: DeskLayout still rendering on / ───────────────────────
heading "BUG-079 — / (Desk) still works (no visible regression from deprecation marker)"
desk_code=$(curl -sS -b "$COOKIE" "$BASE_URL/" -o /dev/null -w "%{http_code}")
if [ "$desk_code" = "200" ]; then
  ok "/ returns 200"
else
  fail "/ returned $desk_code"
fi

# ─── BUG-078: rate-limit response shape ──────────────────────────────
heading "BUG-078 — global rate-limit (cap 600/min default)"
skip "threshold is 600/min — not exercising here to avoid noise; covered by middleware unit test"

# ─── Summary ────────────────────────────────────────────────────────
heading "===== Summary ====="
TOTAL=$((PASS+FAIL+SKIPPED))
echo "passed:  $PASS / $TOTAL"
echo "failed:  $FAIL / $TOTAL"
echo "skipped: $SKIPPED / $TOTAL  (require log-side or load probes)"
echo
if [ "$FAIL" -gt 0 ]; then
  printf "\033[31mFAIL\033[0m — %d audit fixes regressed. Investigate above.\n" "$FAIL"
  exit 1
fi
printf "\033[32mOK\033[0m — every executable audit-fix check passes.\n"
