# Loan Tracker Removal — Complete Repository Audit

**Date:** 2026-10-24  
**Branch:** `mobile-foundation`  
**Scope:** Full removal of the Loan Tracker product feature from all layers of the monorepo

---

## Summary

The Loan Tracker feature (loans, loan payments, loan reminders) has been fully removed from the Spencare codebase. All product-facing code, UI components, API routes, domain logic, MCP tools, mobile screens, notification handlers, and test fixtures have been cleaned of every loan reference.

**Result:** All TypeScript checks pass. All 1,106+ tests pass across 14 packages.

**Not changed:** The production database tables (`loans`, `loan_type` enum, `loan_status` enum) and the dead-code branches in the `confirm_command` SQL function remain in the DB. No migrations were created. The database teardown is a separate, deliberate operation.

---

## Deleted Files

| File | What it was |
|------|-------------|
| `apps/web/app/cash-flow/upcoming/loan-actions.tsx` | Server Action wrappers for loan mutations |
| `apps/web/app/cash-flow/upcoming/loan-sheet.tsx` | Loan creation/edit sheet UI |
| `packages/domain/application/src/queries/loans.ts` | `listAllLoans` query |
| `packages/domain/infra/src/loansRepo.ts` | Supabase repository for `loans` table |

---

## Modified Source Files

### `packages/domain/core/src/safeToSpend.ts`
- Removed `loanReservedTotal: Money` from `SafeToSpendContext` interface
- Removed `loanReservedTotal: Money` from `SafeToSpendResult` interface
- Removed `loanReservedTotal` from the `calculateSafeToSpend` return value

### `packages/domain/core/src/ai.ts`
- Removed `loanReservedTotal` field from the `SafeToSpendJSON` type used by mobile/MCP

### `packages/domain/application/src/index.ts`
- Removed `listAllLoans` from public exports

### `packages/domain/application/src/queries/safeToSpend.ts`
- Removed `listAllLoans` import and call
- Removed `loanReservedTotal` from the assembled `SafeToSpendContext`

### `packages/domain/application/src/queries/upcomingProjection.ts`
- Removed `listAllLoans` import and call
- Removed loan rows from the upcoming projection calculation

### `packages/domain/application/src/notifications/messageComposer.ts`
- Removed all `LOAN_*` event type cases from `composeNotificationMessage`
- Removed `LOAN_*` types from `isFinanciallySensitiveEvent`
- Removed `LOAN_*` types from the `NotificationEventType` union

### `packages/domain/infra/src/index.ts`
- Removed `loansRepo` export

### `apps/web/app/cash-flow/upcoming/actions.ts`
- Removed `deleteLoanAction` server action
- Removed all loan-related imports

### `apps/web/app/cash-flow/upcoming/page.tsx`
- Removed `LoanRow` type usage and loan data fetching
- Removed loan props passed to `UpcomingDashboard`

### `apps/web/app/cash-flow/upcoming/upcoming-dashboard.tsx`
- Removed `LoanRow` import and `loans` prop
- Removed loan section rendering (loan rows, loan add button, `LoanSheet`)
- Removed `deleteLoanAction` prop

### `apps/web/app/cash-flow/page.tsx`
- Removed loan summary card from the Cash Flow overview

### `apps/web/app/cash-flow/cash-flow-overview.tsx`
- Removed `loanReservedTotal` display from the Safe-to-Spend breakdown

### `apps/web/app/home/page.tsx`
- Removed `loanReserveMinor` prop from dashboard data assembly

### `apps/web/app/home/upcoming-widget.tsx`
- Removed loan row rendering from the home dashboard widget

### `apps/web/app/settings/accounts/page.tsx`
- Removed `loanReserveMinor` from account reserve calculation

### `apps/web/app/settings/accounts/account-list.tsx`
- Removed `loanReserveMinor` prop

### `apps/web/app/settings/accounts/account-details-sheet.tsx`
- Removed `loanReserveMinor` prop and "Reserved for loans" section
- Removed `loans` from `reserveBreakdown` type

### `apps/web/components/spencare/financial-overview-cards.tsx`
- Removed loan reserve display from the Safe-to-Spend card

### `apps/web/lib/notifications/eventRules.ts`
- Removed `checkLoanReminder` event rule function
- Removed all `LOAN_*` notification event dispatches

### `apps/web/lib/notifications/notificationChecks.ts`
- Removed `checkLoanReminder` call from the notification check loop

### `apps/web/app/api/mobile/dashboard/route.ts`
- Removed `loanReservedTotal` from the mobile dashboard API response

### `apps/mobile/app/(protected)/home.tsx`
- Removed `loanReservedTotal` from the dashboard display

### `apps/mobile/app/(protected)/upcoming.tsx`
- Removed `LoanRow` component (~87 lines)
- Removed `LoanRowProps` interface
- Removed loan section from the Upcoming screen

### `apps/mobile/app/(protected)/profile.tsx`
- Removed loan account type from the profile screen

### `apps/mobile/lib/api.ts`
- Removed `listLoans` API call
- Removed `LoanRow` type

### `apps/mcp-server/src/tools/readTools.ts`
- Removed `listLoans` MCP read tool (`mcp__...__listLoans`)
- Removed `getSafeToSpend` response field `loanReservedMinor`

### `apps/mcp-server/src/tools/writeTools.ts`
- Removed `proposeCreateLoan`, `proposeUpdateLoan`, `proposeDeleteLoan`, `proposeMarkLoanPaid` MCP write tools

### `apps/mobile/FEATURE_PARITY.md`
- Removed Loan Tracker from the feature parity tracking document

---

## Modified Test Files

### `packages/domain/core/src/safeToSpend.test.ts`
- Removed `loanReservedTotal: money(0)` from `calculateSafeToSpend` call fixtures

### `packages/ai/src/context.test.ts`
- Removed `loanReservedTotal: Money.zero("INR")` from `getSafeToSpend` mock

### `packages/ai/src/orchestrator.test.ts`
- Removed `loanReservedTotal: Money.zero("INR")` from `getSafeToSpend` mock

### `apps/web/app/cash-flow/upcoming/upcoming-dashboard.test.tsx`
- Removed `LoanRow` import
- Removed `deleteLoanAction` mock
- Removed `loans: [] as LoanRow[]` from `emptyProps`

### `apps/web/app/api/mobile/dashboard/route.test.ts`
- Removed `loanReservedTotal: makeMoneyJSON(0)` from the `safeToSpend` fixture

### `apps/web/app/api/mobile/upcoming/route.test.ts`
- Rewrote entirely: removed all `listAllLoans` references and loan-focused tests
- Retained 4 commitment-focused tests (auth failure, token invalid, empty, deleted filter)

### `apps/web/app/settings/accounts/account-details-sheet.test.tsx`
- Removed `loanReserveMinor: 0` from `baseProps()`
- Removed 5 occurrences of `loanReserveMinor={0}` JSX prop
- Removed 3 occurrences of `loans: []` from `reserveBreakdown` objects
- Updated "Three aggregate rows" → "Two aggregate rows" assertion
- Removed `expect(screen.getByText("Reserved for loans"))` assertion
- Updated `getAllByText("None").length` minimum from 3 → 2

### `apps/web/lib/notifications/eventRules.test.ts`
- Removed `checkLoanReminder` import
- Removed entire `checkLoanReminder` describe block (3 tests: LOAN_1_DAY, LOAN_DUE_TODAY, LOAN_OVERDUE)

### `packages/domain/application/src/notifications/messageComposer.test.ts`
- Removed `LOAN_*` event types from the sweep array
- Removed `masks LOAN_1_DAY: no amount, no loan name` privacy masking test

### `apps/mcp-server/src/tools/readTools.test.ts`
- Removed `listAllLoans: vi.fn()` from module mock
- Removed `loanReservedTotal` from two inline `getSafeToSpend` mock objects
- Removed `loanReservedTotal` from `fullMockResult()` helper
- Updated comment "All 11 fields" → "All 10 fields"
- Removed `expect(d).toHaveProperty("loanReservedMinor")` assertion
- Removed `"loanReservedMinor"` from the `monetaryFields` integer-check array

### `apps/mobile/__tests__/dashboard.test.ts`
- Removed `loanReservedTotal: money(0)` from `buildDashboard` fixture
- Removed `loanReservedTotal: money(0)` from override fixture
- Removed `loans` variable and `loanReservedTotal` from "Full STS multi-deduction formula" test
- Updated formula comment to remove `- loanReservedTotal`

---

## Regression Results

### TypeScript
All packages pass `tsc --noEmit` with zero errors.

Build order required (packages resolved `@spencare/*` imports through `dist/`):
1. `@spencare/domain-core`
2. `@spencare/domain-infra`
3. `@spencare/domain-application`
4. `@spencare/ai`
5. `@spencare/mcp-server`

### Tests
```
Tasks:    14 successful, 14 total
Time:     ~37s
```

Key counts:
- `@spencare/web`: 101 test files, 1,106 tests — all passing
- `@spencare/domain-application`: 36 test files, 539 tests — all passing
- All other packages: passed (cached or rebuilt)

---

## What Was NOT Changed (By Design)

| Item | Reason |
|------|--------|
| `supabase/migrations/*loan*` | Migrations are append-only. DB teardown requires a new migration written and applied separately. |
| `loans` table in production DB | Table still holds user data. No DROP until an explicit migration is reviewed and applied. |
| `loan_type` / `loan_status` enums | Postgres enums cannot be dropped while the table exists. |
| `confirm_command` SQL function loan branches | Dead code. Safe to leave; will be cleaned when the table is dropped. |
| MCP remote endpoint response contract | The `listLoans` / loan write tools will still appear to external MCP clients until they refresh their tool list. This is a documentation concern, not a correctness one. |
