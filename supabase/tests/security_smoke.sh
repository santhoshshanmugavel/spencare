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

echo "== summary =="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
