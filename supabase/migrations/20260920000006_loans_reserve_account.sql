-- Add reserve_account_id to loans table.
--
-- Allows a loan's installments to be reserved in a bank/cash account
-- using the same reserve model as planned_commitments.

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS reserve_account_id uuid REFERENCES accounts(id);

COMMENT ON COLUMN loans.reserve_account_id IS
  'Optional bank/cash account from which installments are reserved ahead of the payment date.';
