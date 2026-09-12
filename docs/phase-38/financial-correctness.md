<title>Phase 38 — Financial Correctness</title>

# Phase 38 — Financial Correctness

## No formula touched this phase

Both fixes are purely presentational (a conditional empty-state message,
a conditional helper sentence). Neither reads nor computes a financial
value beyond what already existed (`selectedAccount.type`,
`selectedAccount.name` — both already-fetched `AccountRow` fields, no
new query).

## Trace: UI → command → domain → repository → database (unchanged)

`createTransactionAction`/`transferAction` (the actual write paths) were
not touched. The account-eligibility filtering
(`filterByCapability(accounts, "expenseSource" | "incomeTarget" |
"transferSource" | "transferDestination")`) is the same domain-core
function every prior phase already relied on
(`packages/domain/core/src/accountCapabilities.ts`) — this phase only
read its exported capability table to write accurate copy and to prove
the removed `toEligible`-empty guard was genuinely unreachable, not
guessed at.

## Live-verified

Created a real credit-card expense with the fix's helper note visible;
confirmed via the Accounts screen afterward that the card's outstanding
balance/available-credit figures were unaffected by merely opening the
form (no transaction was actually submitted during this specific check
— the point being verified was the note's correctness and timing, not a
new money-movement path, since none was added).

## Financially destructive-action review

No new destructive or consequential action was added this phase. The
`NoEligibleAccounts` guard is non-consequential (it prevents a doomed
submission, it doesn't perform one).
