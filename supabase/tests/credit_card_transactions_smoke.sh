#!/usr/bin/env bash
# Repeatable live smoke test for Phase 28's credit-card transaction support
# (20260909000001_credit_card_transactions.sql). Same pattern and fixed
# local-dev keys as security_smoke.sh -- see that script's header for why
# this is a manual/CI script rather than a vitest suite (it exercises real
# Postgres RPC behavior, including balance mutation and locking, that
# cannot be meaningfully mocked).
#
# Usage: bash supabase/tests/credit_card_transactions_smoke.sh
# Requires a live local Supabase instance (`npx supabase start`, or
# `npx supabase db reset` after adding a migration).

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
U1=$(signup "cc-smoke-a-${STAMP}@example.com")
U2=$(signup "cc-smoke-b-${STAMP}@example.com")
TOKEN1=$(echo "$U1" | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
TOKEN2=$(echo "$U2" | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
UID1=$(echo "$U1" | python3 -c "import json,sys;print(json.load(sys.stdin)['user']['id'])")
UID2=$(echo "$U2" | python3 -c "import json,sys;print(json.load(sys.stdin)['user']['id'])")
echo "  user1=$UID1  user2=$UID2"
echo

echo "== Setup: user1's bank + credit card accounts =="
BANK=$(curl -s -X POST "$BASE/rest/v1/accounts" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"type\":\"bank\",\"name\":\"CC Smoke Bank\",\"currency\":\"INR\",\"balance_minor\":1000000}")
BANKID=$(echo "$BANK" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

CARD=$(curl -s -X POST "$BASE/rest/v1/accounts" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID1\",\"type\":\"credit_card\",\"name\":\"CC Smoke Card\",\"currency\":\"INR\",\"credit_limit_minor\":10000000,\"credit_used_minor\":3500000}")
CARDID=$(echo "$CARD" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")

CATID=$(curl -s "$BASE/rest/v1/categories?is_system=eq.true&limit=1&select=id" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['id'])")
echo "  bank=$BANKID (balance 1,000,000)  card=$CARDID (limit 10,000,000, used 3,500,000)"
echo

echo "== create_transaction: credit-card expense =="
TXN=$(curl -s -X POST "$BASE/rest/v1/rpc/create_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$CARDID\",\"p_type\":\"expense\",\"p_amount_minor\":500000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
TXNID=$(echo "$TXN" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "credit-card expense increases credit_used_minor (3,500,000 -> 4,000,000)" "4000000" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$BANKID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "bank balance untouched by a credit-card expense (no double counting)" "1000000" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/create_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$CARDID\",\"p_type\":\"income\",\"p_amount_minor\":100,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
check "income cannot target a credit card (account_not_eligible)" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"account_not_eligible\"}HTTP:400" "$R"
echo

echo "== update_transaction: cross-type reassignment (bank <-> credit card) =="
BANK_TXN=$(curl -s -X POST "$BASE/rest/v1/rpc/create_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$BANKID\",\"p_type\":\"expense\",\"p_amount_minor\":200000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
BANK_TXNID=$(echo "$BANK_TXN" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
# bank now 1,000,000 - 200,000 = 800,000

curl -s -X POST "$BASE/rest/v1/rpc/update_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$BANK_TXNID\",\"p_account_id\":\"$CARDID\",\"p_amount_minor\":200000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}" >/dev/null

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$BANKID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "reassigning bank expense to credit card restores bank balance (800,000 -> 1,000,000)" "1000000" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "reassigned expense now shows on the credit card (4,000,000 -> 4,200,000)" "4200000" "$R"

curl -s -X POST "$BASE/rest/v1/rpc/update_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$BANK_TXNID\",\"p_account_id\":\"$BANKID\",\"p_amount_minor\":200000,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}" >/dev/null

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "reassigning back off the credit card restores credit_used_minor (4,200,000 -> 4,000,000)" "4000000" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$BANKID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "expense reapplied to bank (1,000,000 -> 800,000)" "800000" "$R"
echo

echo "== delete_transaction: credit-card expense =="
curl -s -X POST "$BASE/rest/v1/rpc/delete_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$TXNID\"}" >/dev/null

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "deleting a credit-card expense restores available credit (4,000,000 -> 3,500,000)" "3500000" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$BANKID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "bank balance untouched by deleting a credit-card expense" "800000" "$R"
echo

echo "== transfer: credit-card repayment (bank -> credit card) =="
PAY=$(curl -s -X POST "$BASE/rest/v1/rpc/transfer" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_from_account_id\":\"$BANKID\",\"p_to_account_id\":\"$CARDID\",\"p_amount_minor\":150000,\"p_occurred_at\":\"2026-08-25\"}")
FROM_LEG_ID=$(echo "$PAY" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['from_leg']['id'])")

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$BANKID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "repayment reduces bank balance (800,000 -> 650,000)" "650000" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "repayment restores available credit, not counted as a second expense (3,500,000 -> 3,350,000)" "3350000" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/transfer" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_from_account_id\":\"$CARDID\",\"p_to_account_id\":\"$BANKID\",\"p_amount_minor\":100,\"p_occurred_at\":\"2026-08-25\"}")
check "a credit card cannot be used as a transfer source (account_not_eligible)" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"account_not_eligible\"}HTTP:400" "$R"

curl -s -X POST "$BASE/rest/v1/rpc/delete_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" \
  -H "Content-Type: application/json" -d "{\"p_user_id\":\"$UID1\",\"p_transaction_id\":\"$FROM_LEG_ID\"}" >/dev/null

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$BANKID&select=balance_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['balance_minor'])")
check "deleting a repayment (via its bank leg) restores the bank balance (650,000 -> 800,000)" "800000" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "deleting a repayment restores the credit usage it had reduced (3,350,000 -> 3,500,000)" "3500000" "$R"
echo

echo "== IDOR: user2 cannot spoof p_user_id against user1's credit card =="
R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/create_transaction" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_account_id\":\"$CARDID\",\"p_type\":\"expense\",\"p_amount_minor\":100,\"p_category_id\":\"$CATID\",\"p_occurred_at\":\"2026-08-25\"}")
check "user2 cannot spoof p_user_id to charge user1's credit card" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s -w "HTTP:%{http_code}" -X POST "$BASE/rest/v1/rpc/transfer" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d "{\"p_user_id\":\"$UID1\",\"p_from_account_id\":\"$BANKID\",\"p_to_account_id\":\"$CARDID\",\"p_amount_minor\":100,\"p_occurred_at\":\"2026-08-25\"}")
check "user2 cannot spoof p_user_id to repay user1's credit card from user1's bank" "{\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not_authorized\"}HTTP:400" "$R"

R=$(curl -s "$BASE/rest/v1/accounts?id=eq.$CARDID&select=credit_used_minor" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['credit_used_minor'])")
check "user1's credit usage unchanged after every one of user2's spoofed attempts" "3500000" "$R"
echo

echo "== Summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
