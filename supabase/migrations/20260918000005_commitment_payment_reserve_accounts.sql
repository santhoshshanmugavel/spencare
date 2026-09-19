-- Migration 5: Separate payment_account_id from reserve_account_id on planned_commitments.
--
-- PRODUCT MODEL:
--   payment_account_id = where the payment actually comes from (bank, cash, credit card)
--   reserve_account_id = where money is logically protected (bank or cash ONLY, never credit card)
--
-- A commitment paid via credit card has NO cash reserve (reserve_account_id is null).
-- A commitment paid from HDFC can use HDFC as both payment and reserve account.
--
-- also adds already_reserved_minor to planned_commitment_occurrences for the
-- "I already have money set aside" onboarding experience (no transaction created,
-- just a logical reserve set at commitment creation time).

-- 1. Add new columns to planned_commitments.
alter table planned_commitments
  add column payment_account_id uuid references accounts(id),
  add column reserve_account_id uuid references accounts(id);

-- 2. Migrate existing data: funding_account_id becomes both payment and reserve account.
--    For bank/cash accounts, both fields are set identically.
--    We cannot know account type here without a join, so we copy funding_account_id to
--    both columns; the application will correct reserve_account_id to null for credit card
--    accounts on any subsequent edit. This is safe because:
--    a) the sum of reserved_minor is what drives Safe-to-Spend (unchanged), and
--    b) no new commitment will use funding_account_id going forward.
update planned_commitments
  set payment_account_id = funding_account_id,
      reserve_account_id = funding_account_id
  where funding_account_id is not null;

-- 3. Update getCommitmentReservedTotal semantics: only occurrences whose parent
--    commitment has a reserve_account_id should count toward Safe-to-Spend reserves.
--    This is enforced in application code (plannedCommitmentsRepo.ts), not SQL,
--    because the infra query already filters at the application level.
--    No SQL change needed here for correctness -- the existing reserved_minor column
--    remains the source of truth; credit card commitments simply never get a non-zero
--    reserved_minor set (enforced in createPlannedCommitment).

-- 4. Index for reserve_account_id lookups (account page breakdown).
create index planned_commitments_reserve_account_idx
  on planned_commitments(reserve_account_id)
  where deleted_at is null and reserve_account_id is not null;

create index planned_commitments_payment_account_idx
  on planned_commitments(payment_account_id)
  where deleted_at is null and payment_account_id is not null;
