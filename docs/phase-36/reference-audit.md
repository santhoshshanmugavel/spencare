<title>Phase 36 — Reference Audit</title>

# Phase 36 — Reference Audit

Classification key used throughout: VERIFIED (re-read the actual PDF
and/or the actual running screen this phase), CARRIED FORWARD (an
earlier phase's own already-documented, unchanged finding), DECIDED
(resolved this phase via an explicit user decision, not by this
session's own unilateral judgment).

## Home — VERIFIED, then DECIDED (the phase's headline finding)

**REFERENCE**: `Home screen.pdf` and its five variants, read in full
this phase, all show the same screen: "I'm Spensa / Your intelligent
money partner," a large centered ask-input ("Ask me about your
money…"), five quick-reply chips (Add an expense / Add income / Show
account balances / See this month's summary / How much can I spend?),
and a "Complete your setup" grid of four cards (Connect your AI Model /
Set up your accounts / Create a budget / Set a goal).

**CURRENT**: `/home` renders a traditional financial dashboard —
Safe-to-Spend hero, Owned Money, a "Needs your attention" section, a
6-month cash-flow trend chart, a spending-change/top-category insight,
an "Ask Spensa" card, and a setup checklist. Spensa itself lives at a
separate route, `/spensa/[conversationId]`.

**DIFFERENCE**: The reference's "Home screen" files depict a
conversational, Spensa-first landing experience; the built product's
`/home` is a dashboard-first landing experience with Spensa as one
linked-to feature among several.

**WHY IT MATTERS**: This is not a spacing or copy mismatch — it is a
question of what the product's default first screen fundamentally is.
`navigation-rail.tsx`'s own long-standing header comment (predating
this phase) already names this exact tension: "4 destinations
(**Spensa/Home**, Cash Flow, Goals, Settings)" — an earlier phase's own
audit had already noticed the reference conflates these two concepts
into one rail position, without ever fully resolving which one the
built app's first position should be.

**SEVERITY**: Would be P0 (foundational product-identity mismatch) if
acted on unilaterally in either direction — treated as a decision
requiring the product owner's judgment, not a severity this session
should self-assign and act on alone.

**DECISION**: Escalated to the user rather than resolved unilaterally,
given the scale and irreversibility risk of guessing wrong in either
direction. **User's explicit decision**: Home remains Spencare's
primary financial dashboard and default landing experience; Spensa
remains a dedicated surface at `/spensa`; the "Home screen" reference
files are to be interpreted as depicting the Spensa/chat experience
within the broader reference set, not as a requirement to change the
default route. Full decision text in `product-decisions.md`.

**IMPLEMENTATION**: None required by the decision itself (no rebuild).
Verified the existing "Ask Spensa" card on Home already satisfies the
user's accompanying instruction to keep the entry point "prominent and
consistent" — it is unconditionally visible (not gated behind setup
completion), names concrete example questions ("Ask about your
Safe-to-Spend, budgets, goals, or bills"), and has a direct `Chat` CTA.
No second, competing Spensa entry point (e.g., a new nav-rail icon) was
added — the reference's own rail shows exactly one "Spensa/Home"
position, not two, and the user's decision already resolved that one
position in favor of Home; adding a second icon would not be
reference-evidenced and risks exactly the "invent functionality"
Section 0 of this engagement has always forbidden.

**LIVE VERIFICATION**: Confirmed the existing `home-content.tsx` "Ask
Spensa" card's content and placement by reading the current source
(unconditionally rendered, not gated); not re-screenshotted this phase
since no code changed as a result of this decision.

## Cash Flow — CARRIED FORWARD (Phase 35), re-confirmed, not re-rebuilt

Six independent reference screens read across Phase 35/36 remain
consistent: no global Safe-to-Spend card belongs on this page. Phase
35's removal stands; this phase did not re-open additional numbered
Cash Flow files (28 remain unread — see `reference-inventory.md`) since
six consistent, independent reads already gave high confidence, and no
new discrepancy was reported by anything touched this phase.

## Accounts (Add Credit Card) — VERIFIED, confirmed already-documented, no action needed

**REFERENCE**: `Credit Card.pdf`, read in full this phase, shows an
"Add Credit Card" form with two fields the current implementation
lacks: "Billing date (statement date)" and "Payment due in (days)."

**CURRENT**: `add-account-sheet.tsx`'s own header comment already
documents this exact gap, dated to Phase 7: "Fields deliberately NOT
included, documented as scope limitations: … credit-card billing-date/
due-day — neither has a database column."

**DIFFERENCE**: Confirmed real, but not new — an earlier phase already
found and disclosed this exact reference element, and made a
deliberate, reasoned decision not to add it without a real schema
migration (a new `accounts` column) and a genuine product decision
about what feature would consume a billing date (e.g., a credit-card-
specific bill reminder, distinct from the general Bills feature) —
exactly the kind of change this engagement's own standing rule requires
explicit design work for, not a rushed field addition.

**SEVERITY**: P2 (a real, named gap, but already disclosed and
reasoned about, not silently missed).

**DECISION**: No change this phase. Recorded as CONFIRMED-STILL-
ACCURATE documentation, not re-litigated, consistent with Section 31's
"if something works but differs from the reference … if no [UX
improvement from differing]: FIX IT" being outweighed here by "do not
rewrite architecture" and the real schema-migration cost of the honest
fix.

**LIVE VERIFICATION**: Not re-tested live this phase (no code changed);
the comment itself was re-read and confirmed still matches the current
form's actual field set (`grep` for billing/statement/due fields in
`add-account-sheet.tsx` returned only the disclosure comment, no
implementation).

## `All accounts.pdf` filter list — VERIFIED, matches current implementation

The reference shows a simple filter list: "All accounts" (checked) then
each individual account by name. This matches the current Cash Flow
account-filter `<Select>` structure (`All accounts` + one entry per
account, `Name · Type` labeled) already verified live in Phase 35. No
new gap.
