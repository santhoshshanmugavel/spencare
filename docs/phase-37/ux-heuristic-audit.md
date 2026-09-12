<title>Phase 37 — UX Heuristic Audit</title>

# Phase 37 — UX Heuristic Audit

| SCREEN | HEURISTIC | FINDING | SEVERITY | USER IMPACT | FIX | VERIFICATION |
|---|---|---|---|---|---|---|
| Spensa (empty state) | #6 Recognition rather than recall | No starter prompts; a blank ask-input forces the user to invent a useful question. | P1 | First-time users don't know what Spensa can actually do. | Added the reference's 5 starter chips this phase. | VERIFIED live: chips render, click sends a real message, correctly reaches the existing "no provider" error state. |
| Spensa (chip → send) | #3 User control and freedom / #4 Consistency and standards | A chip could have been implemented as a silent action (this file's own header explicitly warns against that pattern); instead it reuses the exact same `handleSend` path a typed message takes. | — (PASS) | User never encounters an ambiguous "did that button just do something invisible?" moment. | N/A — verified correct by construction. | VERIFIED via code path + live click test. |
| Home / Spensa routing | #2 Match between system and real world | A genuine ambiguity in reference intent (dashboard vs. chat-first landing) was found; rather than guess, it was escalated to the product owner. | — (process, not a UI finding) | Avoided a potentially large, wrong, unrequested rebuild. | Resolved by explicit user decision (Decision 1, `product-decisions.md`). | N/A |
| Credit Card account card | #9 Help users recognize/recover from errors (via honesty) | Payment Due / Billing Date are not shown, since they aren't real, tracked data — no placeholder or fabricated date is shown either. | — (PASS) | User is never shown a made-up due date they might trust. | N/A — confirmed correct. | VERIFIED via `reference-screen-matrix.md`/`financial-language-audit.md` code check. |

## Not newly evaluated this phase

A full 10-heuristic sweep across every primary flow (Transactions,
Budgets, Accounts beyond the Credit Card check above) was not re-run
from zero this phase. See `docs/phase-34/ux-heuristic-audit.md` and
`docs/phase-35/ux-quality-gate.md` for their own last-verified state,
unchanged by this phase's diff.
