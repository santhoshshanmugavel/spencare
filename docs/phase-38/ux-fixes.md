<title>Phase 38 — UX Fixes</title>

# Phase 38 — UX Fixes

Both fixes below are on `apps/web/app/cash-flow/transactions/add-transaction-sheet.tsx`.

## Fix 1: zero-eligible-accounts guard (P1)

**HEURISTIC**: #5 Error prevention + #9 Help users recognize, diagnose,
and recover from errors.

**PROBLEM**: `ExpenseIncomeForm` and `TransferForm` each compute a
capability-filtered account list (e.g. `incomeTarget` accounts for the
Income tab). When that list was empty — a real, reachable state (a user
with only a credit card trying to log income, which credit cards can't
receive) — the `<Select>` rendered with zero options and no explanation.
The user's only signal something was wrong would arrive after they tried
to submit and hit a validation error.

**FIX**: A new `<NoEligibleAccounts>` component replaces the form
entirely (before any hook-conditional return, respecting the Rules of
Hooks) when the relevant account list is empty, showing a plain-language
explanation and a real `Add an account` link to `/settings/accounts`.
Copy is specific per case:
- Expense: "You need a bank, cash, or credit card account to record an expense."
- Income: "You need a bank or cash account to record income."
- Transfer (from): "You need a bank or cash account to transfer from."

**WHY NOT a second guard for Transfer's `toEligible`**: verified against
`accountCapabilities.ts` directly — every account type with
`transferSource: true` (bank, cash) also has `transferDestination: true`,
so `fromEligible` is always a subset of `toEligible`. A `toEligible`-
empty state can only occur when `fromEligible` is also empty, which the
first guard already catches. A second guard would have been unreachable
dead code; caught during implementation and removed before it shipped.

**PATTERN REUSE, not invention**: this is the exact same shape
`<GoalWizardSheet>` established in Phase 33 for its own zero-accounts
branch (name the problem, link to the fix) — Consistency and Standards
(heuristic #4), not a new pattern.

## Fix 2: credit-card expense helper note (P2)

**HEURISTIC**: #2 Match between system and real world.

**PROBLEM**: The Transfer form already explains that a credit-card
destination is a repayment ("reduces what you owe... isn't counted as
separate spending"). An expense charged directly to a credit card had no
equivalent explanation, even though it's conceptually the same "this
changes what you owe, not your cash" idea a first-time user could
plausibly misread as spending money they still have.

**FIX**: When `kind === "expense"` and the selected account's type is
`credit_card`, a note appears: "This adds to what you owe on {account
name} -- it doesn't reduce cash in any other account." Computed from
`watch("accountId")` matched against the already-filtered
`eligibleAccounts` list — no new query, no new state beyond what
`react-hook-form` already tracks.

## Tests

`add-transaction-sheet.test.tsx`: 7 new tests across 2 new `describe`
blocks — the helper note appears/disappears correctly by account type;
each transaction kind's zero-eligible-accounts guard shows the right
copy and the right link; the guard correctly disappears once a form is
actually rendered. 18 tests total in the file (up from 11), all passing.

## Live verification

Signed up a fresh test account, added only a Credit Card account
(deliberately — this is the one account type that exercises both fixes
simultaneously: eligible for Expense, ineligible for Income/Transfer).
Confirmed live: Expense tab renders normally, selecting the credit card
shows the exact helper-note text; Income tab shows the exact
zero-eligible message and a working `Add an account` link; Transfer tab
shows the same. Test account deleted afterward via the real Delete
Account flow; confirmed gone via the Supabase admin API.
