<title>Phase 39 — UX Fixes</title>

# Phase 39 — UX Fixes

## P1 fix: Budget form submits ₹0 when default placeholder not typed over

**File**: `apps/web/app/cash-flow/budgets/add-budget-sheet.tsx`

**Root cause**: `useMoneyField()` called without an argument initialises
`display` to `""`. The Amount field showed "5000" as a placeholder (not a
value). Submitting without first typing into the field produced
`amountMinor: 0` — a ₹0 budget that passes the Zod schema (which only
checks the field is present, not that it is > 0) and writes silently.

**Evidence**: Discovered live during the Phase 39 E2E verification on the
real test account. The budget card appeared but showed ₹0 limit. The
placeholder value was visually indistinguishable from a real value at a
glance — a clear UX fidelity defect.

**Fix**:
- `useMoneyField("5000")` — starts display at "5000", not ""
- `defaultValues: { amountMinor: 500000, ... }` — aligns the RHF default
  with the visible display so an untouched submission creates a ₹5,000
  budget, not ₹0
- `reset({ amountMinor: 500000, ... })` — same alignment on form reset
  after a successful submit

The ₹5,000 default matches the field's placeholder so it reads as a
pre-filled suggestion, not just a placeholder — an intent the original
code expressed in the UX but failed to back with real data.

**Tests** (`add-budget-sheet.test.tsx`): 4 tests that typed "6000" into
the amount field previously relied on the field being empty; they now call
`user.clear()` before `user.type()` to reset the pre-filled default. All
650 web tests pass. No test count change (the fix adjusted existing tests,
did not add new ones).

## No other P0/P1 UX findings this phase

All 21 steps of the live E2E journey passed after the P1 fix. No
additional UX defects at P0 or P1 severity were found. Observations at P2
or below are out of scope per this phase's mandate and not built.
