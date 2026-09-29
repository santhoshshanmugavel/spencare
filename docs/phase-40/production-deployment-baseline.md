# Spencare Production Deployment Baseline

Captured read-only, immediately before applying any migration, against project `wjaxxoselhlbjrtuhqlq` (Spencare, ACTIVE_HEALTHY, ap-southeast-2). No secret values are included below.

## Target Verification

- Supabase project: `wjaxxoselhlbjrtuhqlq`, name Spencare, status ACTIVE_HEALTHY. Matches expected.
- Vercel project: `prj_FT209JrlvoguUsfRLR4k655pWFiQ`, name spencare, domains `spencare.vercel.app` + 2 aliases. Matches expected.

## Migration Version

`20260928030846` (= `20260928000003_fix_anon_auth_bypass_transaction_functions`, the only migration ever applied in this program).

## Financial Counts

| Metric | Value |
|---|---|
| Users | 7 |
| Transactions | 118 |
| Accounts | 17 |
| Goals | 8 |
| Planned commitments | 31 |
| Financial plans | 0 |
| Financial plan items | 0 |
| Notifications | 72 |
| Pending confirmations | 75 |
| Total balance (bank + cash accounts, minor units) | 20614346 |
| Total credit used (credit card accounts, minor units) | 16412978 |

## Function State (confirm_command, create_transaction, transfer, update_transaction)

All four: owner `postgres`, `SECURITY DEFINER` = true, `search_path` config = null (not pinned), grants = `postgres:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE` (no `anon`), exactly one overload each.

Exact signatures (unchanged by this release):

- `confirm_command(p_user_id uuid, p_confirmation_id uuid, p_actor audit_actor)`
- `create_transaction(p_user_id uuid, p_account_id uuid, p_type transaction_type, p_amount_minor bigint, p_category_id uuid, p_occurred_at timestamp with time zone, p_item_name text, p_merchant text, p_description text, p_actor audit_actor)`
- `transfer(p_user_id uuid, p_from_account_id uuid, p_to_account_id uuid, p_amount_minor bigint, p_occurred_at timestamp with time zone, p_description text, p_actor audit_actor)`
- `update_transaction(p_user_id uuid, p_transaction_id uuid, p_account_id uuid, p_amount_minor bigint, p_category_id uuid, p_occurred_at timestamp with time zone, p_item_name text, p_merchant text, p_description text, p_actor audit_actor)`

All four currently carry the service-role auth defect this release fixes (`auth.uid() is null or p_user_id <> auth.uid()`).

## Schema State

- `transactions.occurred_at`: `timestamp with time zone` (already correct, unaffected by this release).
- `financial_plans` table: exists (0 rows). Plan-consistency trigger: does not exist (`20260928000002` not part of this release).
- RLS enabled: `transactions` (true), `accounts` (true), `pending_confirmations` (true).
- Trigger count (non-internal): `transactions` 1, `accounts` 1 (both the standard `updated_at` triggers, unaffected by this release).

## Migration Files To Be Applied (checksums for exact-match verification)

- `20260928000008_fix_service_role_auth_check_regression.sql`, MD5 `70912c6e73329a04b0c0eab85ddd6111`
- `20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql`, MD5 `69d416d07787d96b2fed37ecc2607452`

## Application

- Current production deployment: `dpl_CU5EVbfXuCFgp9EZakwRpAyjSyAe`, `readyState: READY`.
- Release to deploy: source state as of commit `d344eac` (identical code as of `2545191`, which adds only documentation on top).
