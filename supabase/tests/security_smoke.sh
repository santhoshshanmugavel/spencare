#!/usr/bin/env bash
# Repeatable live security/IDOR smoke test for Phase 5 (Auth + Identity).
#
# WHY THIS EXISTS: every check below was originally run as an ad hoc curl
# command during Phase 5 development/validation -- including the one that
# caught a genuine bug (column-level REVOKE being silently superseded by an
# earlier table-level GRANT, fixed in
# 20260826000002_security_settings_column_grants_fix.sql). Per the
# instruction not to leave critical security validation as an undocumented
# manual terminal command, this script captures those exact checks as a
# single repeatable artifact.
#
# WHAT THIS IS NOT: a full integration test harness wired into `pnpm test`
# (that belongs to packages/domain/application once it has real Supabase
# integration tests, per testing-architecture.md §2, which explicitly
# scopes RLS/concurrency integration tests to that package once built --
# see the Phase 4B/4C audit notes on this same point). This script requires
# a live local Supabase instance (`npx supabase start`) and network access
# to it; it is NOT run as part of `pnpm test` and does not fit vitest's
# process model (it exercises real Postgres role/grant/RLS behavior that
# cannot be meaningfully mocked). Run it manually after any migration
# change that touches security_settings/profiles/avatars, or wire it into
# a CI step that starts Supabase first.
#
# Usage: bash supabase/tests/security_smoke.sh
# Exit code 0 = every check passed. Non-zero = at least one check failed
# (see the FAIL lines above the summary for which).

set -u
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
# Fixed local-dev demo JWT (same one `supabase status` always prints for a
# fresh `supabase start`) -- needed once, for the Bills section below, to
# seed a `bill_predictions` row directly: that table has SELECT-only RLS
# for `authenticated` (no insert policy at all -- "predictions are written
# exclusively by the background detection job / matching RPCs, which run
# under the service role"), so no authenticated user, including the real
# owner, can insert one via PostgREST. Never sent as an `apikey` header
# alongside a real user's bearer token elsewhere in this script.
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
BASE="http://127.0.0.1:54321"
PASS=0
FAIL=0

check() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $description"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $description (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

signup() {
  curl -s -X POST "$BASE/auth/v1/signup" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"CorrectHorse123\"}"
}

echo "== Setting up two real users =="
STAMP=$(date +%s)
U1=$(signup "sec-smoke-a-${STAMP}@example.com")
U2=$(signup "sec-smoke-b-${STAMP}@example.com")
TOKEN1=$(echo "$U1" | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
TOKEN2=$(echo "$U2" | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
UID1=$(echo "$U1" | python3 -c "import json,sys;print(json.load(sys.stdin)['user']['id'])")
UID2=$(echo "$U2" | python3 -c "import json,sys;print(json.load(sys.stdin)['user']['id'])")
echo "  user1=$UID1  user2=$UID2"
echo

echo "== profiles: ownership / IDOR =="
curl -s -X PATCH "$BASE/rest/v1/profiles?user_id=eq.$UID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d '{"display_name":"User One"}' >/dev/null

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/profiles?user_id=eq.$UID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"display_name":"HACKED"}')
check "user2 cannot update user1's profile (row-level, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s "$BASE/rest/v1/profiles?user_id=eq.$UID1&select=display_name" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['display_name'])")
check "user1's profile unchanged after user2's attempted write" "User One" "$R"

R=$(curl -s "$BASE/rest/v1/profiles?user_id=eq.$UID1&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's profile" "[]" "$R"

echo
echo "== profiles: onboarding data IDOR (Phase 6) =="
curl -s -X PATCH "$BASE/rest/v1/profiles?user_id=eq.$UID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d '{"interested_categories":["Dining"]}' >/dev/null

R=$(curl -s "$BASE/rest/v1/profiles?user_id=eq.$UID1&select=interested_categories,income_amount_minor,onboarding_completed_at" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's onboarding data" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/profiles?user_id=eq.$UID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"onboarding_completed_at":"2020-01-01T00:00:00Z","interested_categories":["HACKED"]}')
check "user2 cannot fake-complete or overwrite user1's onboarding (HTTP 204/0 rows)" "204" "$R"

R=$(curl -s "$BASE/rest/v1/profiles?user_id=eq.$UID1&select=interested_categories,onboarding_completed_at" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;d=json.load(sys.stdin)[0];print(d['interested_categories']==['Dining'] and d['onboarding_completed_at'] is None)")
check "user1's onboarding data unchanged after user2's attempted write" "True" "$R"
echo

echo "== security_settings: column-level secret protection =="
R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/rest/v1/security_settings?user_id=eq.$UID1&select=totp_secret_encrypted" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
check "own-row SELECT of totp_secret_encrypted is denied (column grant)" "403" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/rest/v1/security_settings?user_id=eq.$UID1&select=backup_codes_hash" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
check "own-row SELECT of backup_codes_hash is denied (column grant)" "403" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/security_settings?user_id=eq.$UID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d '{"totp_secret_encrypted":"\\xdeadbeef"}')
check "own-row UPDATE of totp_secret_encrypted is denied (can't bypass encrypt+enroll flow)" "403" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/security_settings?user_id=eq.$UID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d '{"two_factor_enabled":true}')
check "own-row UPDATE of two_factor_enabled is denied (can't self-enable without a real enrollment)" "403" "$R"

R=$(curl -s "$BASE/rest/v1/security_settings?user_id=eq.$UID1&select=two_factor_enabled,two_factor_method,pin_lock_enabled" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;d=json.load(sys.stdin)[0];print(d['two_factor_enabled'])")
check "own-row SELECT of safe status columns still works" "False" "$R"

R=$(curl -s "$BASE/rest/v1/security_settings?user_id=eq.$UID1&select=two_factor_enabled" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's security_settings at all (RLS)" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/security_settings?user_id=eq.$UID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"pin_lock_enabled":true}')
check "user2 cannot modify user1's security_settings (RLS, HTTP 204/0 rows)" "204" "$R"
echo

echo "== audit_log: service-role-only writes =="
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/audit_log" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$UID1\",\"actor\":\"web\",\"action\":\"x\",\"entity_type\":\"account\"}")
check "authenticated client cannot write audit_log directly" "403" "$R"
echo

echo "== avatars storage: path-scoped isolation =="
TMP_IMG=$(mktemp /tmp/avatar-XXXX.png)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82' > "$TMP_IMG"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/storage/v1/object/avatars/$UID1/avatar.png" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: image/png" --data-binary "@$TMP_IMG")
check "user1 can upload to their own avatar path" "200" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/storage/v1/object/avatars/$UID1/avatar.png" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's avatar object directly" "400" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/storage/v1/object/avatars/$UID1/avatar.png" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: image/png" --data-binary "@$TMP_IMG")
check "user2 cannot overwrite user1's avatar object" "400" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/storage/v1/object/avatars/$UID1/avatar.png" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot delete user1's avatar object" "400" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/storage/v1/object/avatars/$UID1/avatar.png" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
check "user1 can read their own avatar object" "200" "$R"

echo "not an image" > /tmp/security-smoke-fake.txt
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/storage/v1/object/avatars/$UID1/fake.txt" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: text/plain" --data-binary "@/tmp/security-smoke-fake.txt")
check "bucket rejects a disallowed MIME type (text/plain) regardless of ownership" "400" "$R"
rm -f /tmp/security-smoke-fake.txt

head -c 6291456 /dev/urandom > /tmp/security-smoke-big.png
R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/storage/v1/object/avatars/$UID1/big.png" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: image/png" --data-binary "@/tmp/security-smoke-big.png")
check "bucket rejects a file over the 5MB limit" "400" "$R"
rm -f /tmp/security-smoke-big.png

rm -f "$TMP_IMG"
echo

echo "== accounts: ownership / IDOR (Phase 7) =="
ACC=$(curl -s -X POST "$BASE/rest/v1/accounts" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"type\":\"bank\",\"name\":\"Smoke Test Bank\",\"currency\":\"INR\",\"balance_minor\":500000}")
ACCID=$(echo "$ACC" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$ACCID&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's account" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/accounts?id=eq.$ACCID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"balance_minor":99999999}')
check "user2 cannot update user1's account balance (HTTP 204/0 rows)" "204" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "user1's balance unchanged after user2's attempted manipulation" "500000" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/accounts" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$UID1\",\"type\":\"bank\",\"name\":\"Spoofed\",\"currency\":\"INR\",\"balance_minor\":0}")
check "user2 cannot insert an account impersonating user1 (RLS with check, HTTP 403/201-blocked)" "403" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/archive_account" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$ACCID\"}")
check "user2 cannot archive user1's account by spoofing p_user_id in the RPC (must be blocked server-side, not just via the app UI)" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$ACCID&select=is_archived" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['is_archived'])")
check "user1's account still not archived after user2's spoofed RPC attempt" "False" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/archive_account" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$ACCID\"}")
check "user1 (real owner) can archive their own account via the RPC" "200" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/rest/v1/accounts?id=eq.$ACCID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot delete user1's account row (RLS, HTTP 204/0 rows)" "204" "$R"
echo

echo "== transactions: ownership / IDOR (Phase 8) =="
TXN_ACC=$(curl -s -X POST "$BASE/rest/v1/accounts" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"type\":\"bank\",\"name\":\"Txn Smoke Bank\",\"currency\":\"INR\",\"balance_minor\":1000000}")
TXN_ACCID=$(echo "$TXN_ACC" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

TXN_ACC2=$(curl -s -X POST "$BASE/rest/v1/accounts" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"type\":\"cash\",\"name\":\"Txn Smoke Cash\",\"currency\":\"INR\",\"balance_minor\":0}")
TXN_ACCID2=$(echo "$TXN_ACC2" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

CATID=$(curl -s "$BASE/rest/v1/categories?is_system=eq.true&limit=1&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

TXN=$(curl -s -X POST "$BASE/rest/v1/rpc/create_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$TXN_ACCID\",\"p_type\":\"expense\",\"p_amount_minor\":50000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
TXNID=$(echo "$TXN" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

R=$(curl -s "$BASE/rest/v1/transactions?id=eq.$TXNID&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's transaction" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/transactions?id=eq.$TXNID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"amount_minor":999999}')
check "user2 cannot update user1's transaction via raw PATCH (RLS, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/transactions" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$UID1\",\"account_id\":\"$TXN_ACCID\",\"type\":\"income\",\"amount_minor\":1,\"currency\":\"INR\",\"category_id\":\"$CATID\",\"occurred_at\":\"2026-08-25\"}")
check "user2 cannot insert a transaction impersonating user1 (RLS with check, HTTP 403)" "403" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/create_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$TXN_ACCID\",\"p_type\":\"expense\",\"p_amount_minor\":50000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
check "user2 cannot spoof p_user_id in create_transaction to post against user1's account" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/transfer" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_from_account_id\":\"$TXN_ACCID\",\"p_to_account_id\":\"$TXN_ACCID2\",\"p_amount_minor\":50000,\"p_occurred_at\":\"2026-08-25\"}")
check "user2 cannot spoof p_user_id in transfer to move user1's money" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/update_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$TXNID\",\"p_account_id\":\"$TXN_ACCID\",\"p_amount_minor\":1,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
check "user2 cannot spoof p_user_id in update_transaction to edit user1's transaction" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/delete_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$TXNID\"}")
check "user2 cannot spoof p_user_id in delete_transaction to delete user1's transaction" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "user1's account balance unchanged after every one of user2's spoofed attempts" "950000" "$R"

R=$(curl -s "$BASE/rest/v1/transactions?id=eq.$TXNID&select=amount_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['amount_minor'])")
check "user1's transaction amount unchanged after user2's spoofed update attempt" "50000" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/update_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$TXNID\",\"p_account_id\":\"$TXN_ACCID\",\"p_amount_minor\":60000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
check "user1 (real owner) can update their own transaction" "200" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/delete_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$TXNID\"}")
check "user1 (real owner) can delete their own transaction" "204" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/rest/v1/transactions?id=eq.$TXNID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot delete user1's transaction row via raw REST DELETE (RLS, HTTP 204/0 rows)" "204" "$R"
echo

echo "== budgets: ownership / IDOR (Phase 9) =="
# Budgets use plain RLS-scoped CRUD, no SECURITY DEFINER RPC (locked Phase 9
# decision: single-table mutation, no cross-table balance, no audit_log
# requirement found in any source document) -- so unlike accounts/transactions
# there is no p_user_id-spoofing RPC vector to test here. Every check below
# is a raw PostgREST call exercising RLS directly.
BUDGET_CATID=$(curl -s "$BASE/rest/v1/categories?is_system=eq.true&limit=1&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

BUDGET=$(curl -s -X POST "$BASE/rest/v1/budgets" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"category_id\":\"$BUDGET_CATID\",\"period_start\":\"2026-08-01\",\"period_end\":\"2026-08-31\",\"amount_minor\":600000}")
BUDGETID=$(echo "$BUDGET" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

R=$(curl -s "$BASE/rest/v1/budgets?id=eq.$BUDGETID&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's budget" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/budgets?id=eq.$BUDGETID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"amount_minor":1}')
check "user2 cannot update (shrink) user1's budget limit (RLS, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s "$BASE/rest/v1/budgets?id=eq.$BUDGETID&select=amount_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['amount_minor'])")
check "user1's budget limit unchanged after user2's attempted manipulation" "600000" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/budgets" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$UID1\",\"category_id\":\"$BUDGET_CATID\",\"period_start\":\"2026-09-01\",\"period_end\":\"2026-09-30\",\"amount_minor\":1}")
check "user2 cannot insert a budget impersonating user1 (RLS with check, HTTP 403)" "403" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/rest/v1/budgets?id=eq.$BUDGETID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot delete user1's budget row (RLS, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s "$BASE/rest/v1/budgets?id=eq.$BUDGETID&select=deleted_at" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['deleted_at'])")
check "user1's budget still not deleted after user2's attempted DELETE" "None" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/budgets?id=eq.$BUDGETID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d '{"amount_minor":750000}')
check "user1 (real owner) can update their own budget" "204" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/budgets?id=eq.$BUDGETID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"deleted_at\":\"2026-08-25T00:00:00Z\"}")
check "user1 (real owner) can soft-delete their own budget" "204" "$R"
echo

echo "== goals: ownership / IDOR (Phase 11) =="
# add_goal_contribution had a confirmed live IDOR (no p_user_id = auth.uid()
# assertion) until migration 20260830000001 -- these checks are the
# permanent regression proving it stays fixed, plus the new
# withdraw_goal_contribution RPC built with the assertion from day one.
GOAL=$(curl -s -X POST "$BASE/rest/v1/goals" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"name\":\"Security Smoke Goal\",\"target_amount_minor\":1000000,\"funding_account_id\":\"$TXN_ACCID\"}")
GOALID=$(echo "$GOAL" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

R=$(curl -s "$BASE/rest/v1/goals?id=eq.$GOALID&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's goal" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/goals?id=eq.$GOALID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"target_amount_minor":1}')
check "user2 cannot update user1's goal (RLS, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/goals?id=eq.$GOALID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"status":"archived"}')
check "user2 cannot archive/delete user1's goal via raw PATCH (RLS, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/add_goal_contribution" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_goal_id\":\"$GOALID\",\"p_account_id\":\"$TXN_ACCID\",\"p_amount_minor\":50000}")
check "user2 cannot spoof p_user_id in add_goal_contribution to contribute to user1's goal" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/withdraw_goal_contribution" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_goal_id\":\"$GOALID\",\"p_account_id\":\"$TXN_ACCID\",\"p_amount_minor\":10000}")
check "user2 cannot spoof p_user_id in withdraw_goal_contribution to withdraw from user1's goal" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/goals?id=eq.$GOALID&select=saved_amount_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['saved_amount_minor'])")
check "user1's goal saved amount unchanged after user2's spoofed contribution/withdrawal attempts" "0" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "user1's account balance unchanged after user2's spoofed goal RPC attempts" "1000000" "$R"

R=$(curl -s "$BASE/rest/v1/transactions?goal_id=eq.$GOALID&user_id=eq.$UID1&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
check "no transaction was created under user1's identity by user2's spoofed attempts" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/rest/v1/goals?id=eq.$GOALID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot delete user1's goal row via raw REST DELETE (RLS, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/add_goal_contribution" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_goal_id\":\"$GOALID\",\"p_account_id\":\"$TXN_ACCID\",\"p_amount_minor\":50000}")
echo "$R" | grep -q '"type":"goal_contribution"' && check "user1 (real owner) can contribute to their own goal" "pass" "pass" || check "user1 (real owner) can contribute to their own goal" "pass" "fail: $R"

R=$(curl -s "$BASE/rest/v1/goals?id=eq.$GOALID&select=saved_amount_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['saved_amount_minor'])")
check "user1's goal saved amount reflects their own legitimate contribution" "50000" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/withdraw_goal_contribution" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_goal_id\":\"$GOALID\",\"p_account_id\":\"$TXN_ACCID\",\"p_amount_minor\":20000}")
echo "$R" | grep -q '"type":"goal_withdrawal"' && check "user1 (real owner) can withdraw from their own goal" "pass" "pass" || check "user1 (real owner) can withdraw from their own goal" "pass" "fail: $R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/withdraw_goal_contribution" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_goal_id\":\"$GOALID\",\"p_account_id\":\"$TXN_ACCID\",\"p_amount_minor\":99999999}")
check "withdrawing more than the goal's saved amount is rejected (insufficient_saved_amount)" "400" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/goals" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$UID1\",\"name\":\"Spoofed\",\"target_amount_minor\":1,\"funding_account_id\":\"$TXN_ACCID\"}")
check "user2 cannot insert a goal impersonating user1 (RLS with check, HTTP 403)" "403" "$R"
echo

echo "== bills: ownership / IDOR (Phase 12) =="
# bill_definitions has full plain-RLS owner CRUD (checked the same way as
# goals/budgets below). bill_predictions has SELECT-only RLS -- seeded
# directly with the service role key (see the SERVICE_ROLE_KEY comment
# above), since no authenticated user, including the real owner, can
# insert one via PostgREST.
BILL=$(curl -s -X POST "$BASE/rest/v1/bill_definitions" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"merchant_pattern\":\"Smoke Test Netflix\",\"expected_amount_minor\":49900,\"recurrence_interval\":\"monthly\",\"detection_source\":\"manual\"}")
BILLID=$(echo "$BILL" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

PRED=$(curl -s -X POST "$BASE/rest/v1/bill_predictions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"bill_definition_id\":\"$BILLID\",\"user_id\":\"$UID1\",\"expected_date\":\"2026-09-15\",\"expected_amount_minor\":49900,\"status\":\"open\"}")
PREDID=$(echo "$PRED" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

R=$(curl -s "$BASE/rest/v1/bill_definitions?id=eq.$BILLID&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's bill definition" "[]" "$R"

R=$(curl -s "$BASE/rest/v1/bill_predictions?id=eq.$PREDID&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's bill prediction" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/bill_definitions?id=eq.$BILLID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"merchant_pattern":"Hijacked"}')
check "user2 cannot update user1's bill definition via raw PATCH (RLS, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/bill_definitions" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$UID1\",\"merchant_pattern\":\"Spoofed\",\"recurrence_interval\":\"monthly\",\"detection_source\":\"manual\"}")
check "user2 cannot insert a bill definition impersonating user1 (RLS with check, HTTP 403)" "403" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/mark_bill_paid" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_prediction_id\":\"$PREDID\",\"p_account_id\":\"$TXN_ACCID\",\"p_category_id\":\"$CATID\",\"p_amount_minor\":49900,\"p_occurred_at\":\"2026-09-15\"}")
check "user2 cannot spoof p_user_id in mark_bill_paid to settle user1's bill" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
# 970000 is TXN_ACCID's running balance carried in from the Transactions
# and Goals sections above (1000000 - 50000 contribution + 20000
# withdrawal), not a Bills-specific figure -- this check only cares that
# it did NOT additionally drop by 49900 (the spoofed mark_bill_paid's
# amount), which would prove the spoofed call actually moved money.
check "user1's account balance unchanged after user2's spoofed mark_bill_paid attempt" "970000" "$R"

R=$(curl -s "$BASE/rest/v1/bill_predictions?id=eq.$PREDID&select=status" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['status'])")
check "user1's prediction still open after user2's spoofed mark_bill_paid attempt" "open" "$R"

TXN2=$(curl -s -X POST "$BASE/rest/v1/rpc/create_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$TXN_ACCID\",\"p_type\":\"expense\",\"p_amount_minor\":1000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
TXNID2=$(echo "$TXN2" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/match_bill_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_prediction_id\":\"$PREDID\",\"p_transaction_id\":\"$TXNID2\"}")
check "user2 cannot spoof p_user_id in match_bill_transaction to settle user1's bill" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/bill_predictions?id=eq.$PREDID&select=status" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['status'])")
check "user1's prediction still open after user2's spoofed match_bill_transaction attempt" "open" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/mark_bill_paid" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_prediction_id\":\"$PREDID\",\"p_account_id\":\"$TXN_ACCID\",\"p_category_id\":\"$CATID\",\"p_amount_minor\":49900,\"p_occurred_at\":\"2026-09-15\"}")
check "user1 (real owner) can mark their own bill paid via the RPC" "200" "$R"

R=$(curl -s "$BASE/rest/v1/bill_predictions?id=eq.$PREDID&select=status,matched_transaction_id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
echo "$R" | grep -q '"status":"matched"' && check "user1's prediction is matched after mark_bill_paid" "pass" "pass" || check "user1's prediction is matched after mark_bill_paid" "pass" "fail: $R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/mark_bill_paid" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_prediction_id\":\"$PREDID\",\"p_account_id\":\"$TXN_ACCID\",\"p_category_id\":\"$CATID\",\"p_amount_minor\":49900,\"p_occurred_at\":\"2026-09-15\"}")
check "a second mark_bill_paid on an already-matched prediction is rejected (prediction_already_settled, no double payment)" "400" "$R"

MATCHEDTXNID=$(curl -s "$BASE/rest/v1/bill_predictions?id=eq.$PREDID&select=matched_transaction_id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['matched_transaction_id'])")

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/delete_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$MATCHEDTXNID\"}")
check "user1 can undo a mark-paid bill by deleting the matched transaction (delete_transaction, HTTP 204 -- void return, same as the Phase 8 delete check above)" "204" "$R"

R=$(curl -s "$BASE/rest/v1/bill_predictions?id=eq.$PREDID&select=status,matched_transaction_id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
echo "$R" | grep -q '"status":"open"' && echo "$R" | grep -q '"matched_transaction_id":null' && check "deleting the matched transaction reopens the prediction (Phase 8's delete_transaction behavior, reused unmodified for Bills)" "pass" "pass" || check "deleting the matched transaction reopens the prediction (Phase 8's delete_transaction behavior, reused unmodified for Bills)" "pass" "fail: $R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/match_bill_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_prediction_id\":\"$PREDID\",\"p_transaction_id\":\"$TXNID2\"}")
check "user1 (real owner) can match an existing transaction to their own reopened prediction" "200" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/match_bill_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_prediction_id\":\"$PREDID\",\"p_transaction_id\":\"$TXNID2\"}")
check "matching an already-matched prediction a second time is rejected (prediction_already_settled)" "400" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/rest/v1/bill_definitions?id=eq.$BILLID" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot delete user1's bill definition row via raw REST DELETE (RLS, HTTP 204/0 rows)" "204" "$R"

# create_bill: a real defect found live (a plain bill_definitions insert
# alone leaves a bill with zero predictions, permanently invisible) means
# this RPC exists specifically to atomically create the definition AND an
# initial prediction together -- both the IDOR guard and the atomic
# dual-insert itself need their own direct coverage here, distinct from
# the raw-insert-based bill_definitions checks above.
R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/create_bill" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_merchant_pattern\":\"Spoofed Bill\",\"p_recurrence_interval\":\"monthly\",\"p_initial_expected_date\":\"2026-09-15\"}")
check "user2 cannot spoof p_user_id in create_bill to create a bill under user1's identity" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

BILLS_BEFORE=$(curl -s "$BASE/rest/v1/bill_definitions?user_id=eq.$UID1&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "user1 has no bill created under their identity by user2's spoofed create_bill attempt" "1" "$BILLS_BEFORE"

RPCBILL=$(curl -s -X POST "$BASE/rest/v1/rpc/create_bill" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_merchant_pattern\":\"Smoke Test Electricity\",\"p_recurrence_interval\":\"monthly\",\"p_initial_expected_date\":\"2026-09-20\"}")
RPCBILLID=$(echo "$RPCBILL" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

R=$(curl -s "$BASE/rest/v1/bill_predictions?bill_definition_id=eq.$RPCBILLID&select=status,expected_date" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
echo "$R" | grep -q '"status":"open"' && echo "$R" | grep -q '"expected_date":"2026-09-20"' && check "create_bill atomically generated the initial open prediction (the real defect's fix)" "pass" "pass" || check "create_bill atomically generated the initial open prediction (the real defect's fix)" "pass" "fail: $R"

RPCBILL2=$(curl -s -X POST "$BASE/rest/v1/rpc/create_bill" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_merchant_pattern\":\"Smoke Test One-off Repair\",\"p_recurrence_interval\":\"irregular\"}")
RPCBILLID2=$(echo "$RPCBILL2" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
R=$(curl -s "$BASE/rest/v1/bill_predictions?bill_definition_id=eq.$RPCBILLID2&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "create_bill generates NO prediction for an irregular bill (no deterministic first occurrence to fabricate)" "0" "$R"
echo

echo "== imports: ownership / IDOR (Phase 15) =="

BALANCE_BEFORE_IMPORT=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")

IMPBATCH=$(curl -s -X POST "$BASE/rest/v1/import_batches" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"source_type\":\"csv\",\"account_id\":\"$TXN_ACCID\",\"file_name\":\"smoke.csv\",\"file_size_bytes\":100}")
IMPBATCHID=$(echo "$IMPBATCH" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
check "user1 (real owner) can create their own import batch (authenticated insert policy)" "1" "$(echo "$IMPBATCH" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")"

# import_staged_transactions has NO authenticated insert policy by design
# (staged rows are written by the processing pipeline, service role only)
# -- seeding here mirrors the real application's own service-role insert.
STAGED_EXPENSE=$(curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"import_batch_id\":\"$IMPBATCHID\",\"user_id\":\"$UID1\",\"raw_payload\":{\"line\":\"smoke expense\"},\"normalized_amount_minor\":45000,\"normalized_date\":\"2026-08-12\",\"normalized_merchant\":\"Smoke Swiggy\",\"suggested_category_id\":\"$CATID\",\"staged_transaction_type\":\"expense\",\"confidence_score\":0.900,\"review_status\":\"accepted\"}")
STAGEDID1=$(echo "$STAGED_EXPENSE" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

STAGED_INCOME=$(curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"import_batch_id\":\"$IMPBATCHID\",\"user_id\":\"$UID1\",\"raw_payload\":{\"line\":\"smoke income\"},\"normalized_amount_minor\":500000,\"normalized_date\":\"2026-08-13\",\"normalized_merchant\":\"Smoke Salary\",\"suggested_category_id\":\"$CATID\",\"staged_transaction_type\":\"income\",\"confidence_score\":0.950,\"review_status\":\"accepted\"}")
STAGEDID2=$(echo "$STAGED_INCOME" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

STAGED_PENDING=$(curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"import_batch_id\":\"$IMPBATCHID\",\"user_id\":\"$UID1\",\"raw_payload\":{\"line\":\"smoke pending\"},\"normalized_amount_minor\":10000,\"normalized_date\":\"2026-08-14\",\"normalized_merchant\":\"Smoke Untouched\",\"suggested_category_id\":null,\"staged_transaction_type\":\"expense\",\"confidence_score\":0.400,\"review_status\":\"pending\"}")
STAGEDID3=$(echo "$STAGED_PENDING" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

curl -s -X PATCH "$BASE/rest/v1/import_batches?id=eq.$IMPBATCHID" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"status":"awaiting_review"}' > /dev/null

R=$(curl -s "$BASE/rest/v1/import_batches?id=eq.$IMPBATCHID&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's import batch (RLS)" "[]" "$R"

R=$(curl -s "$BASE/rest/v1/import_staged_transactions?import_batch_id=eq.$IMPBATCHID&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's staged rows (RLS)" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/import_staged_transactions?id=eq.$STAGEDID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"review_status":"rejected"}')
check "user2 cannot update user1's staged row (RLS, HTTP 204/0 rows)" "204" "$R"
R=$(curl -s "$BASE/rest/v1/import_staged_transactions?id=eq.$STAGEDID1&select=review_status" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
echo "$R" | grep -q '"review_status":"accepted"' && check "user1's staged row unchanged after user2's spoofed update attempt" "pass" "pass" || check "user1's staged row unchanged after user2's spoofed update attempt" "pass" "fail: $R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$IMPBATCHID\"}")
check "user2 cannot spoof p_user_id in confirm_import_batch to confirm user1's import" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID2\",\"p_import_batch_id\":\"$IMPBATCHID\"}")
check "user2 cannot confirm user1's import batch under their own identity (import_batch_not_found -- RLS-scoped lookup)" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"import_batch_not_found\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "user1's account balance unchanged after every one of user2's spoofed confirm_import_batch attempts" "$BALANCE_BEFORE_IMPORT" "$R"

echo
echo "== imports: confirmation atomicity + financial correctness (Phase 15) =="

R=$(curl -s -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$IMPBATCHID\"}")
echo "$R" | grep -q '"status":"confirmed"' && check "user1 (real owner) can confirm their own import batch via the RPC" "pass" "pass" || check "user1 (real owner) can confirm their own import batch via the RPC" "pass" "fail: $R"

R=$(curl -s "$BASE/rest/v1/import_staged_transactions?id=eq.$STAGEDID1&select=created_transaction_id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
CREATEDTXN1=$(echo "$R" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['created_transaction_id'])")
[ "$CREATEDTXN1" != "None" ] && check "the accepted expense staged row is linked to a real created transaction" "pass" "pass" || check "the accepted expense staged row is linked to a real created transaction" "pass" "fail: not linked"

R=$(curl -s "$BASE/rest/v1/transactions?id=eq.$CREATEDTXN1&select=type,amount_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
echo "$R" | grep -q '"type":"expense"' && echo "$R" | grep -q '"amount_minor":45000' && check "confirm_import_batch maps staged_transaction_type=expense to transactions.type=expense with a POSITIVE amount_minor (never a sign-derived type)" "pass" "pass" || check "confirm_import_batch maps staged_transaction_type=expense to transactions.type=expense with a POSITIVE amount_minor (never a sign-derived type)" "pass" "fail: $R"

R=$(curl -s "$BASE/rest/v1/import_staged_transactions?id=eq.$STAGEDID2&select=created_transaction_id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
CREATEDTXN2=$(echo "$R" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['created_transaction_id'])")
R=$(curl -s "$BASE/rest/v1/transactions?id=eq.$CREATEDTXN2&select=type,amount_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
echo "$R" | grep -q '"type":"income"' && echo "$R" | grep -q '"amount_minor":500000' && check "confirm_import_batch maps staged_transaction_type=income to transactions.type=income with a POSITIVE amount_minor" "pass" "pass" || check "confirm_import_batch maps staged_transaction_type=income to transactions.type=income with a POSITIVE amount_minor" "pass" "fail: $R"

R=$(curl -s "$BASE/rest/v1/import_staged_transactions?id=eq.$STAGEDID3&select=review_status,created_transaction_id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
echo "$R" | grep -q '"review_status":"pending"' && echo "$R" | grep -q '"created_transaction_id":null' && check "the untouched pending row was NEVER included in confirmImport -- still pending, no transaction created (never silently auto-accepted regardless of confidence)" "pass" "pass" || check "the untouched pending row was NEVER included in confirmImport -- still pending, no transaction created" "pass" "fail: $R"

EXPECTED_BALANCE=$((BALANCE_BEFORE_IMPORT - 45000 + 500000))
R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "account balance reflects exactly one batched update summing both accepted rows (net +455000), not one update per row" "$EXPECTED_BALANCE" "$R"

R=$(curl -s "$BASE/rest/v1/audit_log?entity_id=eq.$IMPBATCHID&action=eq.confirm_import_batch&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "confirm_import_batch wrote exactly one audit_log entry for the whole batch (not one per row)" "1" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$IMPBATCHID\"}")
check "a second confirm_import_batch call on an already-confirmed batch is rejected (double confirmation prevented)" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"import_batch_not_confirmable\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "balance unchanged after the rejected double-confirmation attempt (no double-application)" "$EXPECTED_BALANCE" "$R"

echo
echo "== imports: cancellation (Phase 15) =="

IMPBATCH2=$(curl -s -X POST "$BASE/rest/v1/import_batches" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"source_type\":\"csv\",\"account_id\":\"$TXN_ACCID\",\"file_name\":\"smoke2.csv\",\"file_size_bytes\":100}")
IMPBATCHID2=$(echo "$IMPBATCH2" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"import_batch_id\":\"$IMPBATCHID2\",\"user_id\":\"$UID1\",\"raw_payload\":{},\"normalized_amount_minor\":100,\"normalized_date\":\"2026-08-15\",\"staged_transaction_type\":\"expense\",\"confidence_score\":0.5,\"review_status\":\"pending\"}" > /dev/null
curl -s -X PATCH "$BASE/rest/v1/import_batches?id=eq.$IMPBATCHID2" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"status":"awaiting_review"}' > /dev/null

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/import_batches?id=eq.$IMPBATCHID2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"status":"cancelled"}')
check "user2 cannot cancel user1's batch via raw REST PATCH (RLS, HTTP 204/0 rows)" "204" "$R"
R=$(curl -s "$BASE/rest/v1/import_batches?id=eq.$IMPBATCHID2&select=status" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
echo "$R" | grep -q '"status":"awaiting_review"' && check "user1's batch unchanged after user2's spoofed cancel attempt" "pass" "pass" || check "user1's batch unchanged after user2's spoofed cancel attempt" "pass" "fail: $R"

curl -s -X PATCH "$BASE/rest/v1/import_batches?id=eq.$IMPBATCHID2" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d '{"status":"cancelled","cancelled_at":"2026-08-15T00:00:00Z"}' > /dev/null
curl -s -X DELETE "$BASE/rest/v1/import_staged_transactions?import_batch_id=eq.$IMPBATCHID2" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" > /dev/null
R=$(curl -s "$BASE/rest/v1/import_staged_transactions?import_batch_id=eq.$IMPBATCHID2&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "cancelling a batch removes its staged rows (hard delete, the one documented soft-delete exception)" "0" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$IMPBATCHID2\"}")
check "a cancelled batch can never be confirmed" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"import_batch_not_confirmable\"}HTTP:400" "$R"

echo
echo "== imports: concurrency (Phase 15, api-architecture.md §5.3 scenario 4) =="

IMPBATCH3=$(curl -s -X POST "$BASE/rest/v1/import_batches" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"source_type\":\"csv\",\"account_id\":\"$TXN_ACCID\",\"file_name\":\"smoke3.csv\",\"file_size_bytes\":100}")
IMPBATCHID3=$(echo "$IMPBATCH3" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"import_batch_id\":\"$IMPBATCHID3\",\"user_id\":\"$UID1\",\"raw_payload\":{},\"normalized_amount_minor\":7500,\"normalized_date\":\"2026-08-16\",\"suggested_category_id\":\"$CATID\",\"staged_transaction_type\":\"expense\",\"confidence_score\":0.9,\"review_status\":\"accepted\"}" > /dev/null
curl -s -X PATCH "$BASE/rest/v1/import_batches?id=eq.$IMPBATCHID3" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"status":"awaiting_review"}' > /dev/null

BALANCE_BEFORE_RACE=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")

# Two simultaneous confirm_import_batch calls for the SAME batch: the
# batch-row FOR UPDATE lock must serialize them so exactly one succeeds.
curl -s -w "HTTP:%{http_code}\n" -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$IMPBATCHID3\"}" > /tmp/import_race_a.out &
curl -s -w "HTTP:%{http_code}\n" -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$IMPBATCHID3\"}" > /tmp/import_race_b.out &
wait

SUCCESSES=$(grep -l "HTTP:200" /tmp/import_race_a.out /tmp/import_race_b.out 2>/dev/null | wc -l | tr -d ' ')
check "exactly one of two concurrent confirm_import_batch calls on the same batch succeeds" "1" "$SUCCESSES"

EXPECTED_BALANCE_AFTER_RACE=$((BALANCE_BEFORE_RACE - 7500))
R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "concurrent double-confirmation applied the balance delta exactly once, not twice" "$EXPECTED_BALANCE_AFTER_RACE" "$R"

R=$(curl -s "$BASE/rest/v1/transactions?import_batch_id=eq.$IMPBATCHID3&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "exactly one transaction was created from the raced batch, not two" "1" "$R"

# Import confirmation + a concurrent manual transaction on the SAME
# account (api-architecture.md §5.3's fourth mandatory scenario).
IMPBATCH4=$(curl -s -X POST "$BASE/rest/v1/import_batches" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"source_type\":\"csv\",\"account_id\":\"$TXN_ACCID\",\"file_name\":\"smoke4.csv\",\"file_size_bytes\":100}")
IMPBATCHID4=$(echo "$IMPBATCH4" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"import_batch_id\":\"$IMPBATCHID4\",\"user_id\":\"$UID1\",\"raw_payload\":{},\"normalized_amount_minor\":3000,\"normalized_date\":\"2026-08-17\",\"suggested_category_id\":\"$CATID\",\"staged_transaction_type\":\"income\",\"confidence_score\":0.9,\"review_status\":\"accepted\"}" > /dev/null
curl -s -X PATCH "$BASE/rest/v1/import_batches?id=eq.$IMPBATCHID4" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"status":"awaiting_review"}' > /dev/null

BALANCE_BEFORE_MIXED_RACE=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")

curl -s -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$IMPBATCHID4\"}" > /tmp/import_mixed_a.out &
curl -s -X POST "$BASE/rest/v1/rpc/create_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$TXN_ACCID\",\"p_type\":\"expense\",\"p_amount_minor\":2000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-17\"}" > /tmp/import_mixed_b.out &
wait

EXPECTED_BALANCE_MIXED=$((BALANCE_BEFORE_MIXED_RACE + 3000 - 2000))
R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "concurrent confirm_import_batch + create_transaction on the same account both apply, serialized, no lost update" "$EXPECTED_BALANCE_MIXED" "$R"

echo
echo "== imports: storage path isolation (Phase 15) =="

R=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/storage/v1/object/statements/$UID1/$IMPBATCHID/smoke.csv" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's statement file directly from Storage (path-scoped RLS)" "400" "$R"

echo

echo "== Spensa: pending_confirmations ownership / IDOR (Phase 16) =="

# A real Spensa-shaped proposal: a createTransaction confirmation for a
# 300-rupee expense on user1's own account/category.
PC1=$(curl -s -X POST "$BASE/rest/v1/pending_confirmations" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"source\":\"spensa\",\"command_type\":\"createTransaction\",\"payload\":{\"accountId\":\"$TXN_ACCID\",\"type\":\"expense\",\"amountMinor\":30000,\"categoryId\":\"$CATID\",\"occurredAt\":\"2026-08-20\"},\"preview\":{\"summary\":\"Log a 300 rupee expense\"},\"expires_at\":\"2026-12-31T00:00:00Z\"}")
PCID1=$(echo "$PC1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

R=$(curl -s "$BASE/rest/v1/pending_confirmations?id=eq.$PCID1&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's pending confirmation" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/pending_confirmations?id=eq.$PCID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"status":"cancelled"}')
check "user2 cannot cancel user1's pending confirmation via raw REST PATCH (RLS, HTTP 204/0 rows)" "204" "$R"
R=$(curl -s "$BASE/rest/v1/pending_confirmations?id=eq.$PCID1&select=status" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['status'])")
check "user1's pending confirmation unchanged after user2's spoofed cancel attempt" "pending" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_command" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_confirmation_id\":\"$PCID1\"}")
check "user2 cannot confirm user1's pending confirmation, even naming user1's own id as p_user_id (spoofed user_id rejected)" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_command" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID2\",\"p_confirmation_id\":\"$PCID1\"}")
check "user2 cannot confirm user1's pending confirmation by naming their own (real) user_id -- the row just isn't theirs" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"confirmation_not_found\"}HTTP:400" "$R"

BALANCE_BEFORE_CONFIRM=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_command" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_confirmation_id\":\"$PCID1\"}")
check "user1 (real owner) can confirm their own pending confirmation via the RPC" "200" "$R"

EXPECTED_BALANCE_AFTER_CONFIRM=$((BALANCE_BEFORE_CONFIRM - 30000))
R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "confirming a Spensa proposal applies the real domain command exactly once" "$EXPECTED_BALANCE_AFTER_CONFIRM" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_command" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_confirmation_id\":\"$PCID1\"}")
check "a second confirm attempt on the same (already-confirmed) confirmation is rejected -- not replayable" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"confirmation_not_pending\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "the replayed confirm attempt did not apply the balance delta a second time" "$EXPECTED_BALANCE_AFTER_CONFIRM" "$R"

echo
echo "== Spensa: pending_confirmations expiry (Phase 16) =="

PC2=$(curl -s -X POST "$BASE/rest/v1/pending_confirmations" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"source\":\"spensa\",\"command_type\":\"createTransaction\",\"payload\":{\"accountId\":\"$TXN_ACCID\",\"type\":\"expense\",\"amountMinor\":10000,\"categoryId\":\"$CATID\",\"occurredAt\":\"2026-08-20\"},\"preview\":{\"summary\":\"Log a 100 rupee expense\"},\"expires_at\":\"2020-01-01T00:00:00Z\"}")
PCID2=$(echo "$PC2" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_command" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_confirmation_id\":\"$PCID2\"}")
# Deliberately HTTP 200 with a structured {"error":...} body, not a
# raised/400 Postgres exception -- see the migration's own comment on why
# raising here would have silently rolled back the status='expired' update
# a few lines below this check.
check "an already-expired pending confirmation cannot be confirmed" "{\"error\": \"confirmation_expired\"}HTTP:200" "$R"

R=$(curl -s "$BASE/rest/v1/pending_confirmations?id=eq.$PCID2&select=status" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['status'])")
check "the rejected expired confirmation is marked expired, not left dangling as pending" "expired" "$R"

BALANCE_AFTER_EXPIRY_ATTEMPT=$(curl -s "$BASE/rest/v1/accounts?id=eq.$TXN_ACCID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "an expired confirmation never applies its balance delta" "$EXPECTED_BALANCE_AFTER_CONFIRM" "$BALANCE_AFTER_EXPIRY_ATTEMPT"

echo
echo "== Spensa: ai_conversations / ai_messages ownership / IDOR (Phase 16) =="

CONV1=$(curl -s -X POST "$BASE/rest/v1/ai_conversations" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"title\":\"Safe to Spend\"}")
CONVID1=$(echo "$CONV1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

MSG1=$(curl -s -X POST "$BASE/rest/v1/ai_messages" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"conversation_id\":\"$CONVID1\",\"role\":\"user\",\"content\":{\"kind\":\"text\",\"text\":\"How much can I spend?\"}}")
MSGID1=$(echo "$MSG1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

R=$(curl -s "$BASE/rest/v1/ai_conversations?id=eq.$CONVID1&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's conversation" "[]" "$R"

R=$(curl -s "$BASE/rest/v1/ai_messages?id=eq.$MSGID1&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's message (join-based RLS through ai_conversations)" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/rest/v1/ai_conversations?id=eq.$CONVID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d '{"title":"HACKED"}')
check "user2 cannot rename user1's conversation (RLS, HTTP 204/0 rows)" "204" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/ai_messages" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" -d "{\"conversation_id\":\"$CONVID1\",\"role\":\"user\",\"content\":{\"kind\":\"text\",\"text\":\"injected\"}}")
check "user2 cannot insert a message into user1's conversation (join-based RLS WITH CHECK, HTTP 403)" "403" "$R"
R=$(curl -s "$BASE/rest/v1/ai_messages?conversation_id=eq.$CONVID1&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "user1's conversation still shows only their own message -- user2's insert attempt silently failed RLS, not silently succeeded" "1" "$R"

echo
echo "== Spensa: ai_provider_credentials ownership / IDOR (Phase 16) =="

CRED1=$(curl -s -X POST "$BASE/rest/v1/ai_provider_credentials" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"provider\":\"anthropic\",\"encrypted_api_key\":\"\\\\x00112233\",\"key_last_four\":\"abcd\",\"is_active\":true}")
CREDID1=$(echo "$CRED1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

R=$(curl -s "$BASE/rest/v1/ai_provider_credentials?id=eq.$CREDID1&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot read user1's AI provider credential row at all (RLS)" "[]" "$R"

R=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/rest/v1/ai_provider_credentials?id=eq.$CREDID1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2")
check "user2 cannot delete user1's AI provider credential (RLS, HTTP 204/0 rows)" "204" "$R"
R=$(curl -s "$BASE/rest/v1/ai_provider_credentials?id=eq.$CREDID1&select=id" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "user1's credential row still exists after user2's spoofed delete attempt" "1" "$R"

echo

echo "== summary =="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
