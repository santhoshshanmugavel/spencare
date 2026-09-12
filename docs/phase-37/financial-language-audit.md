<title>Phase 37 — Financial Language Audit</title>

# Phase 37 — Financial Language Audit

## Terms re-confirmed this phase (spot-checked live, prior phases)

| Term | Where shown | Meaning enforced by code | Status |
|---|---|---|---|
| Safe-to-Spend | Home hero (state-driven; shown once real netting exists) | `getSafeToSpend` — Bank+Cash − reserved goals − upcoming bills | VERIFIED (Phase 35 live check) |
| Available Balance | Home hero (balance_only state, no goals/budget/bills yet) | Same underlying figure as Safe-to-Spend when nothing exists to net — correctly NOT called "Safe-to-Spend" prematurely | VERIFIED (Phase 35) |
| Owned Money | Home, Safe-to-Spend supporting line | Bank + Cash only | CARRIED FORWARD |
| Available Credit | Home, Cash Flow (per-account filtered view) | Credit limit − used, always separate from owned money | VERIFIED (Phase 35 — computed correctly after a real transaction: ₹50,000 − ₹15,000 − ₹499 = ₹34,501) |
| Investments | Home | Investment account market value, never spendable cash | CARRIED FORWARD |
| Net Worth | Home | Assets − liabilities, a distinct concept from Safe-to-Spend | VERIFIED (Phase 35 live check, exact figure confirmed) |
| Upcoming Bills | Cash Flow tab | Reused verbatim, never renamed elsewhere | CARRIED FORWARD |
| Spend Limits | Budget panel | Reused verbatim | CARRIED FORWARD |

## Credit Card fields — reference gap, correctly not faked (VERIFIED)

`Credit Card.pdf`/`-1`..`-3` show Payment Due date and Billing Date
fields the product does not currently support. Confirmed this phase
(via the reference-screen matrix): the current `account-card.tsx`
correctly shows only Credit Limit / Outstanding Balance / Available
Credit — no fabricated due-date or billing-cycle data anywhere. This is
the correct behavior per Section 28 ("never fabricate payment dates").
Recorded as a genuine, disclosed reference gap requiring real schema/
domain work if ever built, not a UI oversight.

## No contradictory terminology found this phase

No screen touched or spot-checked this phase used "Balance,"
"Available," or "Remaining" in a way that could be confused with Safe-
to-Spend, Available Credit, or Investments without clear surrounding
context (e.g., "Available Balance -- HDFC Bank" always names the
account; "Available Credit -- Amex" always names the account and
appears alongside a "Not included in Safe to Spend" note, per Phase 29's
own established pattern, re-confirmed live in Phase 35).
