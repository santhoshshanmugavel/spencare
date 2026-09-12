<title>Phase 35 — UX Quality Gate</title>

# Phase 35 — UX Quality Gate

Per Section 2's own instruction, this records real, observed issues in
THIS product — not a generic heuristic essay. Each row states whether it
was VERIFIED live this phase or CARRIED FORWARD from an earlier phase's
own already-documented, unchanged finding.

| SCREEN | HEURISTIC | OBSERVATION | SEVERITY | USER IMPACT | FIX | VERIFICATION |
|---|---|---|---|---|---|---|
| Cash Flow (All accounts) | #8 Aesthetic and minimalist design / #4 Consistency and standards | A reference-unevidenced global Safe-to-Spend/Net Worth card sat above the transaction workspace, competing with the page's own budget panel for the same kind of figure. | P1 | Confusion about which "spendable amount" figure applies where; visual noise before the page's actual content. | Removed this phase — see `docs/phase-35/reference-audit.md` / `product-decisions.md`. | VERIFIED: live browser walkthrough + updated test suite + full regression. |
| Cash Flow transaction row | #2 Match between system and real world | Account label consistently uses `Name · Type` (e.g. "ICICI Credit Card · Credit Card"), disambiguating accounts that could otherwise share a name. | — (PASS) | Prevents a real, if currently latent, ambiguity. | None needed. | VERIFIED live this phase on a real transaction row. |
| Cash Flow transaction detail | #1 Visibility of system status / #3 User control and freedom | The row-detail interaction is a real right-side Sidekick sheet (not a centered modal), showing amount, account, date, a spend-summary sentence, and a Configure section (Type/Category/Account) with Edit/Delete/Close all present and reachable. | — (PASS) | User can review and act on a transaction without losing their place in the list behind it. | None needed. | VERIFIED live this phase (opened, read full content, closed). |
| Home (balance_only state) | #2 Match between system and real world / #9 Help users recognize errors | "Available Balance" (not "Safe to Spend") is shown when there's nothing yet to net against goals/budget/bills. | — (PASS) | Avoids overclaiming a "safe" figure with nothing behind it. | None needed — confirmed intentional. | VERIFIED live this phase on a fresh account; underlying logic/tests unchanged. |
| Cash Flow budget panel (no budget yet) | #6 Recognition rather than recall / #8 Aesthetic and minimalist design | Shows a `Set up budgets` CTA rather than an empty/zeroed progress bar. | — (PASS, carried forward) | User isn't shown confusing "0 of ₹0" chrome. | None needed. | CARRIED FORWARD (Phase 30B/34, re-confirmed live this phase incidentally while testing the Cash Flow fix). |
| Account creation (Add account sheet) | #5 Error prevention | Credit card form asks for both "Total credit limit" and "Current outstanding balance" as two distinct, clearly-labeled fields, preventing the ambiguity of a single "balance" field on a credit product. | — (PASS) | User cannot accidentally conflate their limit with their current debt. | None needed. | VERIFIED live this phase (created a real credit card account with distinct limit/balance values, confirmed the resulting Available Credit figure — ₹50,000 limit − ₹15,000 seed − ₹499 new expense = ₹34,501 shown — computed correctly). |
| Delete-account confirmation | #5 Error prevention | Names concrete consequences (a bulleted list, not "Are you sure?") and requires typing the account's own email as a second, deliberate step. | — (PASS, carried forward) | Prevents an accidental irreversible action. | None needed. | CARRIED FORWARD (Phase 34); re-exercised live this phase to clean up test data — confirmed the account and every row was actually gone via the admin API, not just the UI's own claim. |

## Not newly evaluated this phase

Transactions' full add/edit/delete matrix beyond the one row created,
Budgets' recurring/override UX, Accounts' archive/delete confirmations,
Spensa's chat experience, and a fresh accessibility/responsive sweep
were not re-run this phase. See `docs/phase-34/ux-heuristic-audit.md`
and `docs/phase-34/customer-readiness.md` for their last-verified state,
unchanged by anything in this phase's diff.
