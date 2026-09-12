<title>Phase 35 — Product Decision Log</title>

# Phase 35 — Product Decision Log

## Decision 1: Remove the global Safe-to-Spend/Net Worth strip from Cash Flow's "All accounts" view

**PROBLEM**: Cash Flow's overview page showed a Safe-to-Spend hero card
+ an Available Credit/Investments/Net Worth card block, positioned above
the AI insight and the transaction workspace. Four consecutive phases
(30B, 33, 34, 35) raised the same concern in slightly different words:
"Safe-to-Spend must not overpower the transaction workspace" / "verify
whether it appears in the correct location." Phase 30B's fix made the
card visually *smaller*, but never questioned whether it belonged on
this page at all.

**USER IMPACT**: A user opening Cash Flow to answer "where did my money
go?" (this page's own stated purpose, per the product's IA) sees a
large, colorful, hero-styled global spending-capacity figure before
anything about their actual transactions — competing with, and
potentially confused for, the page's own budget-scoped "Available to
spend this month" figure two sections below it.

**OPTIONS CONSIDERED**:
1. Keep it, shrink it further.
2. Move it below the transaction workspace instead of above.
3. Remove it entirely from this page; rely on Home for the global figure
   and the existing budget panel for the page-scoped figure.

**DECISION**: Option 3 — removed.

**WHY**: Six independent reference screens, read directly this phase,
are unanimous: none show this card on Cash Flow. Home already owns
"how much can I safely spend, overall" as its dedicated hero (unchanged,
untouched). Cash Flow's own budget panel already answers the page-
appropriate version of the question ("how much of this month's budget
is left") exactly as the reference depicts it. A third, redundant
"spendable amount" figure on one page works against — not for — the
mandate's own repeated Information Architecture goal of each page
answering one clear question. Options 1 and 2 would have kept treating
the symptom (visual weight, placement) that four phases already tried
adjusting without resolving the actual complaint; Option 3 addresses the
root question ("does this belong on this page at all?") that no prior
phase had actually asked against real reference evidence.

**TRADEOFF**: A user who filters Cash Flow to "All accounts" now has
one fewer figure directly on that page and must go to Home to see
global Safe-to-Spend, Net Worth, or Available Credit. This is judged an
acceptable, even clarifying, tradeoff — Home is one click away via the
nav rail, always available, and is the product's own established,
correct home for that figure. The single-account-filtered view keeps
its own small, page-contextual balance/credit-available card, since
that one is genuinely scoped to what the filter is showing and has no
reference contradiction.

**METRIC**: If this proves wrong in practice, the signal would be users
frequently bouncing from Cash Flow to Home within the same session
specifically to check Safe-to-Spend — not something this session can
measure without the analytics pipeline described in
`docs/phase-35/metrics-product-spec.md` (BLOCKED pending that
instrumentation).

**VERIFICATION**: `cash-flow-overview.test.tsx` updated (2 new tests
directly assert the card's absence on the all-accounts view and its
per-account counterpart's continued presence); full `turbo` regression
green; live browser walkthrough with real seeded data (a bank account,
a credit card, one real transaction) confirms the resulting page
structure.

## Decision 2: Keep the `Name · Type` account-label convention over the reference's plain name

**PROBLEM**: The reference's transaction table shows plain account
names ("IDFC", "HDFC") with no type suffix; this mandate's own Section
11/13 explicitly requires `Account Name · Account Type` everywhere.

**DECISION**: Kept the existing `Name · Type` convention; did not
"fix" it to match the reference's plain label.

**WHY**: This mandate's own Section 32 rule ("financial correctness and
usability outrank pixel imitation") applies directly — the plain-name
convention becomes genuinely ambiguous the moment a user has two
accounts sharing a name fragment (a "HDFC" bank account and, say, a
future "HDFC" credit card). The type suffix costs nothing in clarity and
prevents a real, if currently latent, confusion. Not treated as a gap to
close.

**TRADEOFF**: A very small, one-line visual difference from the pixel
reference on every transaction row. Judged clearly worth it.

**VERIFICATION**: Confirmed live this phase on a real transaction row
("ICICI Credit Card · Credit Card").

## Decision 3: Do not "fix" Home's balance_only-state "Available Balance" label

**PROBLEM**: A fresh account with no goals/budgets/bills shows
"Available Balance" instead of "Safe to Spend" on Home.

**DECISION**: No change — confirmed as intentional, already-tested
progressive disclosure (Phase 29), not a defect.

**WHY**: Calling a plain, un-netted balance "Safe to Spend" before
there's anything to be "safe" against would be exactly the kind of
overclaiming this mandate's own Section 6/11 metric-quality rules
forbid ("never manufacture" a concept the data doesn't yet support). The
label correctly upgrades once real goals/budget/bill data exists to net
against.
