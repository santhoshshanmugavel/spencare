<title>Phase 39 — Financial Correctness</title>

# Phase 39 — Financial Correctness

## What was touched

Only `add-budget-sheet.tsx` changed — the `amountMinor` default and
display initialisation. No financial formula, no money-movement path, no
database write path was added or modified.

## Live verification: five financial properties confirmed

All assertions made against the real `phase39-verify@example.com` account
on local Supabase before it was deleted.

**1. initialSavedAmountMinor does not debit the funding account**
Goal wizard created "Emergency Fund" with ₹5,000 already saved (HDFC Bank
as funding account). The goal detail dialog immediately after creation
showed "No contributions yet." — confirming `saved_amount_minor` was set
directly on the `goals` row without calling `add_goal_contribution`, and
without touching HDFC Bank's balance. Phase 33 guarantee still holds.

**2. Goal contribution debits the funding account**
Added ₹2,000 via "Save more" from HDFC Bank. Goal updated from ₹5,000 to
₹7,000 (= ₹5,000 + ₹2,000 ✓). Home page "Reserved for goals" updated to
₹7,000.00 immediately.

**3. Net worth formula**
Observed: Bank+Cash ₹1,35,500 + Investments ₹50,000 − CC outstanding
₹5,000 = ₹1,80,500. Matched the Net Worth figure displayed on Home ✓.

**4. Credit card transfer reduces outstanding**
₹10,000 transfer from HDFC Bank → ICICI Credit Card recorded as a
repayment, not a spending event. Both sides of the transfer appeared in
the transaction list (one outflow from HDFC, one inflow to ICICI). CC
available credit reflected the change ✓.

**5. Safe-to-Spend label transition**
"Available Balance" shown on the empty-state home (no budgets or goals).
After adding budgets and a goal, the hero label transitioned to "Safe to
Spend" — the label-transition invariant from Phase 33 still holds ✓.

## Formula touched this phase

None. The budget form change only affects how the frontend initialises a
draft form value. The server action (`createBudgetAction`) and its Zod
schema (`createBudgetSchema`) are unchanged.

## Financially destructive-action review

No new destructive or consequential action was added this phase.
