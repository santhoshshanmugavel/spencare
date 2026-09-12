<title>Phase 36 — UX Quality Audit</title>

# Phase 36 — UX Quality Audit (NN/g + Apple HIG lens)

## Delta from Phase 35

No code changed this phase except the `security_smoke.sh` test-hygiene
fix (not a product surface). Phase 35's `ux-quality-gate.md` findings
all stand unchanged. This document adds the one genuinely new
finding-and-resolution this phase produced.

| SCREEN | HEURISTIC | FINDING | SEVERITY | USER IMPACT | FIX | VERIFICATION |
|---|---|---|---|---|---|---|
| Home | #2 Match between system and real world / #4 Consistency and standards | The product's own reference material for "Home" describes a different primary experience (Spensa-conversational) than what's built (a dashboard). `navigation-rail.tsx`'s own long-standing comment already flagged the rail-icon version of this same tension. | Would be P0 if acted on unilaterally; resolved as a product decision, not a code defect. | A first-time user's expectations, if they'd seen the original design reference, might differ from what's built — but the built dashboard is itself a coherent, tested, well-reasoned experience in its own right. | Escalated to the user; resolved by explicit decision to keep the dashboard. No code change. | Decision recorded in `product-decisions.md`; the existing "Ask Spensa" card's content re-verified to already meet the user's follow-up bar for discoverability. |
| Accounts (Add Credit Card) | #6 Recognition rather than recall | Reference shows billing-date/payment-due-day fields; current form doesn't collect them. | P2 (real, but already disclosed since Phase 7, not newly missed). | A user with a credit card who wants Spencare to remind them of a due date cannot set one up. | None this phase — would require a schema migration and a real product decision about what feature consumes the field, judged out of proportion for this pass. | Confirmed the existing disclosure comment in `add-account-sheet.tsx` still accurately describes the current form. |
| `security_smoke.sh` (OAuth section) | #5 Error prevention (of the test suite itself, not the product) | A fixture row leaked across runs, producing a false failure signal three phases running. | P3 | Wastes triage time re-diagnosing a known-benign false failure. | Fixed: added a cleanup step. | Ran the script twice back-to-back with no manual intervention; confirmed self-healing and steady-state clean. |

## Apple HIG lens, applied to this phase's one real decision

**Clarity**: The decision to keep Home as a dashboard, rather than
switching to a chat-first landing page, favors clarity for a financial
product specifically — a glanceable Safe-to-Spend figure communicates
financial reality faster than a blank chat prompt a user must first
think of a question for. **Familiarity**: consistent with how most
consumer finance apps (not just this one) present a numbers-first
landing screen; a chat-first landing is a less familiar pattern for
this category, which the user's decision implicitly favors. **Craft**:
preserved by NOT bolting on an unreviewed second Spensa entry point
"for completeness" — the existing single, well-labeled entry point is
kept as the one deliberate access path, rather than adding UI for its
own sake.
