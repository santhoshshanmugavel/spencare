#!/usr/bin/env bash
# Repeatable live smoke test for Phase 28's credit-card import support
# (20260909000002_credit_card_imports.sql). Same pattern as
# security_smoke.sh / credit_card_transactions_smoke.sh.
#
# Usage: bash supabase/tests/credit_card_import_smoke.sh
# Requires a live local Supabase instance.

set -u
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
# import_staged_transactions has no authenticated-role INSERT policy --
# staged rows are populated exclusively by the server-side parser/mapping
# pipeline (running under the service role), same shape as
# security_smoke.sh's bill_predictions seeding. Never sent as an `apikey`
# header alongside a real user's bearer token elsewhere in this script.
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

echo "== Setup =="
STAMP=$(date +%s)
U1=$(signup "cc-import-smoke-${STAMP}@example.com")
TOKEN1=$(echo "$U1" | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
UID1=$(echo "$U1" | python3 -c "import json,sys;print(json.load(sys.stdin)['user']['id'])")

CARD=$(curl -s -X POST "$BASE/rest/v1/accounts" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"type\":\"credit_card\",\"name\":\"Import Smoke Card\",\"currency\":\"INR\",\"credit_limit_minor\":10000000,\"credit_used_minor\":1000000}")
CARDID=$(echo "$CARD" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
CATID=$(curl -s "$BASE/rest/v1/categories?is_system=eq.true&limit=1&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
echo "  card=$CARDID (limit 10,000,000, used 1,000,000)"
echo

echo "== Credit-card import: expense-only batch =="
BATCH=$(curl -s -X POST "$BASE/rest/v1/import_batches" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"account_id\":\"$CARDID\",\"source_type\":\"csv\",\"file_name\":\"card.csv\",\"status\":\"awaiting_review\"}")
BATCHID=$(echo "$BATCH" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"import_batch_id\":\"$BATCHID\",\"user_id\":\"$UID1\",\"staged_transaction_type\":\"expense\",\"normalized_amount_minor\":250000,\"normalized_date\":\"2026-08-25\",\"normalized_merchant\":\"Amazon\",\"suggested_category_id\":\"$CATID\",\"review_status\":\"accepted\",\"raw_payload\":{},\"confidence_score\":0.9}" >/dev/null

R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$BATCHID\"}")
check "confirming a credit-card expense-only import batch succeeds" "200" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "imported credit-card expense increases credit_used_minor (1,000,000 -> 1,250,000)" "1250000" "$R"
echo

echo "== Credit-card import: a batch containing income fails closed, not partial =="
BATCH2=$(curl -s -X POST "$BASE/rest/v1/import_batches" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"account_id\":\"$CARDID\",\"source_type\":\"csv\",\"file_name\":\"card2.csv\",\"status\":\"awaiting_review\"}")
BATCH2ID=$(echo "$BATCH2" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"import_batch_id\":\"$BATCH2ID\",\"user_id\":\"$UID1\",\"staged_transaction_type\":\"expense\",\"normalized_amount_minor\":50000,\"normalized_date\":\"2026-08-26\",\"normalized_merchant\":\"Flipkart\",\"suggested_category_id\":\"$CATID\",\"review_status\":\"accepted\",\"raw_payload\":{},\"confidence_score\":0.9}" >/dev/null
curl -s -X POST "$BASE/rest/v1/import_staged_transactions" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"import_batch_id\":\"$BATCH2ID\",\"user_id\":\"$UID1\",\"staged_transaction_type\":\"income\",\"normalized_amount_minor\":10000,\"normalized_date\":\"2026-08-26\",\"normalized_merchant\":\"Refund\",\"suggested_category_id\":\"$CATID\",\"review_status\":\"accepted\",\"raw_payload\":{},\"confidence_score\":0.9}" >/dev/null

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/confirm_import_batch" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_import_batch_id\":\"$BATCH2ID\"}")
check "a credit-card batch containing an income row is rejected wholesale" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"account_not_eligible\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "no partial import happened -- credit usage unchanged after the rejected batch" "1250000" "$R"

R=$(curl -s "$BASE/rest/v1/transactions?import_batch_id=eq.$BATCH2ID&select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1")
check "zero transactions were created from the rejected batch (whole-transaction rollback)" "[]" "$R"
echo

echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
