-- Spencare database schema, part 1: extensions + enums.
-- Source of truth: /docs/architecture/database-architecture.md §1-2.
-- Do not add, remove, or rename an enum value without updating that document first.

create extension if not exists pgcrypto;

create type account_type as enum ('bank','cash','credit_card','investment');
create type transaction_type as enum ('income','expense','transfer','goal_contribution','goal_withdrawal');

-- transaction_status is deliberately posted|pending ONLY. An earlier draft also
-- included 'voided', which overlapped with deleted_at (soft delete) as two
-- signals for "this transaction no longer counts." deleted_at is the sole
-- signal for user-initiated removal; status is reserved for bank-clearing
-- state only. See database-architecture.md §2.
create type transaction_status as enum ('posted','pending');

create type goal_status as enum ('active','completed','archived');
create type bill_prediction_status as enum ('open','matched','skipped','overdue');
create type import_source_type as enum ('csv','pdf_statement','manual','copy_paste');
create type import_status as enum ('uploaded','processing','awaiting_review','confirmed','failed','cancelled');
create type staged_review_status as enum ('pending','accepted','edited','rejected');
create type ai_provider as enum ('anthropic','openai','google','openrouter','other');
create type confirmation_status as enum ('pending','confirmed','cancelled','expired');
create type confirmation_source as enum ('web','spensa','mcp');
create type two_factor_method as enum ('totp','email_otp');

-- audit_actor shares its vocabulary with confirmation_source deliberately
-- ('web'/'spensa'/'mcp' record the channel, not whether a human was involved --
-- a human is required to confirm in all three cases). 'system' additionally
-- covers unattended background jobs. See database-architecture.md §2.
create type audit_actor as enum ('web','spensa','mcp','system');

create type recurrence_interval as enum ('weekly','biweekly','monthly','quarterly','yearly','irregular');
