<title>Phase 35 — Reference Audit</title>

# Phase 35 — Reference Audit

Every claim below is labeled VERIFIED (re-read the actual reference PDF
and/or the actual running screen this phase), INFERRED (reasoned from
adjacent evidence, not directly pixel-checked this phase), or CARRIED
FORWARD (Phase 30B/31/33/34's own already-documented, unchanged finding,
cited rather than re-derived).

## Cash Flow — VERIFIED, fixed

**REFERENCE**: Six independent reference screens re-read directly this
phase — `Cash Flow.pdf`, `Cash Flow-1.pdf`, `Cash Flow - Recent
Transactions-1.pdf`, `Cash Flow Overview.pdf`, `Cash Flow Overview-1.pdf`,
`Cash Flow Overview After Budget.pdf`. All six consistently show: Header
(title, centered month nav, account filter/Add/Spensa icon) → toolbar
(category filter + tabs + search, exact row varies slightly between two
observed design iterations) → a full-width AI insight card → a
two-column workspace (date-grouped transaction table on the left; a
Spending/Income-toggle donut chart + a budget-state panel on the right).
**None of the six show a global Safe-to-Spend or Net Worth card
anywhere on this page.**

**CURRENT (before this phase)**: `cash-flow-overview.tsx` rendered a
`SafeToSpendHeroCard` + `FinancialLayersCard` (Available Credit /
Investments / Net Worth) block between the toolbar and the AI insight —
the first substantial content a user saw on the page, above the
transaction workspace it was supposedly "supporting."

**GAP**: A visually dominant, reference-unevidenced element sitting
exactly where four prior phases (30B, 33, 34, and this one) were told
"Safe-to-Spend must not overpower the workspace." It also duplicated,
without clear differentiation, the page's own correctly-implemented
"Available to spend this month / ₹X / ₹Y budget" panel already present
in the right column — two different "how much can I spend" figures on
one page risks exactly the concept-mixing Section 5 of this and prior
mandates warns against.

**SEVERITY**: P1 (major reference/product mismatch, repeatedly flagged
across four phases without being fully resolved).

**RECOMMENDED CHANGE / IMPLEMENTATION**: Removed the block from the
"All accounts" view. Kept the smaller, page-contextual per-selected-
account balance/credit card, which has no reference contradiction and
serves a narrower, genuinely useful purpose. `getSafeToSpend`/
`getNetWorth` themselves are untouched — this is a display decision on
one page, not a financial-formula change. Full reasoning recorded in
`docs/phase-35/product-decisions.md`.

**VERIFICATION**: `cash-flow-overview.test.tsx` updated (10 obsolete
tests removed/replaced with 2 new ones asserting the card's absence and
the per-account card's continued presence); full `turbo` regression
green (22/22, 642 web tests); live browser walkthrough with a fresh
seeded account (bank + credit card, one real transaction) confirmed the
resulting page structure — insight banner, date-grouped transaction row
with `Name · Type` account label, right-side Sidekick detail sheet,
donut + "Set up budgets" panel — matches the reference's structure with
no competing hero card.

## Transaction row / Account label — VERIFIED, confirmed correct (no change)

**REFERENCE**: The reference's own transaction table shows a plain
account name in the Account column (e.g. "IDFC", "IDFC credit card",
"HDFC") with no explicit type suffix.

**CURRENT**: `accountTag()` (`apps/web/lib/transaction-presentation.ts`)
renders `"{name} · {TYPE_LABEL}"` (e.g. "ICICI Credit Card · Credit
Card") — verified live this phase on a real transaction row.

**GAP**: A literal pixel mismatch against the reference's plain label.

**SEVERITY**: Not a defect — a deliberate, already-reasoned deviation.

**RECOMMENDED CHANGE**: None. This mandate's own Section 11/13 (across
Phase 34 and 35) explicitly requires the `Name · Type` format
specifically to disambiguate accounts once a user has more than one
account that could share a plain name (e.g. two different "HDFC"
products). Financial clarity/disambiguation outranks literal pixel
imitation here, per this mandate's own Section 32 rule. Recorded as a
confirmed-correct decision, not re-litigated.

## Home's "Available Balance" vs "Safe to Spend" label — VERIFIED, confirmed correct (no change)

**OBSERVATION**: On a fresh account with no goals/budgets/bills
configured, Home's hero card is titled "Available Balance," not "Safe
to Spend."

**NOT A BUG**: `SafeToSpendHeroCard`'s own state-driven label (Phase
29's design) intentionally uses "Available Balance" for the
`balance_only` state — when there is nothing to net out (no goals, no
budget, no upcoming bills), the two concepts are numerically identical,
and asserting "Safe to Spend" with nothing behind it would be the
overclaiming this mandate itself warns against ("do not manufacture
benchmarks" / "never claim more than the data supports"). The label
correctly upgrades to "Safe to Spend" once a real budget/goal/bill
exists to be netted against (verified in the existing, passing
`financial-overview-cards.test.tsx`/`cash-flow-overview.test.tsx` test
suites, not re-derived this phase).

**VERIFICATION**: Live-observed this phase on a fresh seeded account;
the underlying state-transition logic and its tests are unchanged and
were not touched this phase.

## Goal Detail insight, Goal Wizard, Privacy Mode — CARRIED FORWARD (Phase 34)

Not re-derived from zero this phase; Phase 34's own live verification
(OFF/ON/refresh/navigate cycle for the new Goal Detail insight card, the
full Goal Wizard happy-path and financial-correctness check) stands
unchanged, since none of that code was touched this phase.

## Not re-audited this phase

Transactions (add/edit/delete flows beyond the one row exercised
live), Budgets (recurring/override UX), Accounts (archive/delete flows),
Spensa's chat UI, and Settings were not re-inspected against their
reference PDFs from zero this phase. No new discrepancy was found or
reported in the parts of them this phase's own browser walkthrough
touched incidentally (account creation, transaction creation).
