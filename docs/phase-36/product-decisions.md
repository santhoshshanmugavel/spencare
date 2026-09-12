<title>Phase 36 — Product Decision Log</title>

# Phase 36 — Product Decision Log

## Decision 1: Home stays the financial dashboard; "Home screen.pdf" is interpreted as the Spensa surface, not a routing requirement

**PROBLEM**: `Home screen.pdf` and its five variants — read in full for
the first time this deeply this engagement — depict a Spensa-
conversational landing page (ask-input, quick-reply chips, a 4-card
setup checklist), not the financial dashboard that has been built,
tested, and refined as `/home` across 35 phases.

**USER IMPACT if resolved wrong**: Guessing "rebuild Home as a chat
landing page" risks discarding a large amount of tested, working,
audited dashboard functionality (Safe-to-Spend, Owned Money, Needs your
attention, the trend chart) on the strength of a filename, with no way
to undo the cost if the interpretation was wrong. Guessing "ignore the
reference entirely" risks missing a genuine, intentional product-
identity signal from the design source of truth.

**OPTIONS PRESENTED TO THE USER**:
1. Keep the dashboard as Home (current implementation), treating the
   reference files as describing the existing `/spensa` surface.
2. Make Spensa chat the literal default landing route, per the
   reference's literal content.
3. Build both as separate routes and compare before deciding.
4. Let the user supply missing context.

**DECISION** (made by the user, not this session): Option 1. Home
remains the primary financial dashboard and default authenticated
landing experience. Spensa remains the dedicated AI surface at
`/spensa`. No routing change. The "Home screen" reference set is
understood as depicting the Spensa/chat experience within the broader
reference catalog, not as evidence the app's default route must change.

**WHY**: Stated by the user: the dashboard "is already the financial
command center and has undergone extensive implementation, testing,
Privacy Mode verification, financial-correctness verification,
responsive testing, and reference-fidelity work." Consistent with this
engagement's own repeated principle that a large, working, well-
evidenced system should not be discarded on a single, late-discovered,
ambiguous reference signal without explicit sign-off from whoever owns
the product decision.

**PRODUCT IA restated by the user, now the standing reference for this
engagement**:
- Home → Financial command center
- Cash Flow → Cash-flow analysis and transaction workspace
- Budgets → Planning and spending limits
- Goals → Goal planning and progress
- Accounts → Money/account management
- Spensa → AI financial brain
- Settings → Configuration, privacy, integrations and providers

**TRADEOFF**: The product does not literally match the "Home screen"
reference's visual content. This is accepted, explicitly, in exchange
for preserving a large body of already-correct, tested work and
avoiding an unreviewed structural rewrite.

**FOLLOW-UP asked for and verified, not built**: the user asked to
"make Spensa highly discoverable... keep the entry point prominent and
consistent... allow users to move from a dashboard insight → Spensa."
Checked this phase: Home's existing "Ask Spensa" card is already
unconditionally visible (not gated behind setup completion), names
concrete example questions, and has a direct CTA — already satisfies
this instruction as written. No second Spensa entry point (e.g. a new
nav-rail icon) was added: the reference's own rail shows exactly one
combined "Spensa/Home" position, already resolved in favor of Home by
this same decision; a second, additional icon would not be reference-
evidenced and was judged an invented addition, not a verified gap.

**VERIFICATION**: Decision recorded here and in `reference-audit.md`;
`home-content.tsx`'s existing Ask-Spensa card content re-read and
confirmed to already meet the stated bar; no code changed as a result
of this decision, so no new tests were needed.

## Decision 2: Leave the credit-card billing-date/due-day gap as-is

See `reference-audit.md`'s Accounts section for the full record. Not
re-litigated here beyond noting it follows the same "preserve working,
deliberately-scoped decisions over an unreviewed schema change" logic
as Decision 1.

## Decision 3: Fix `security_smoke.sh`'s recurring test-fixture leak

**PROBLEM**: The `oauth_clients` registration check left a row behind
after every run, causing the NEXT run to report a false 409/failed
check. This recurred identically in Phases 34, 35, and now 36's own
baseline run, each time worked around manually rather than fixed at the
source.

**DECISION**: Added a real cleanup step (`DELETE
.../oauth_clients?client_id=eq.spc_client_smoke_test`) immediately
after the registration check, in the script itself.

**WHY**: A three-times-recurring, well-understood, low-risk fix
directly in scope for "smallest safe change" — every other section of
this script already cleans up its own fixture rows; this was the one
exception.

**VERIFICATION**: Ran the script twice in immediate succession with no
manual cleanup in between — first run cleaned up the pre-existing
leftover from before the fix and itself passed 229/0 after that
cleanup executed; a third run confirmed steady-state idempotency
(229/0 again). This will not recur in Phase 37+.
