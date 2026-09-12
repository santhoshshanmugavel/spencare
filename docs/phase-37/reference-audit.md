<title>Phase 37 — Reference Audit</title>

# Phase 37 — Reference Audit

## Finding 1 — Spensa's empty state was missing the reference's starter-prompt chips (VERIFIED, fixed)

**REFERENCE**: `Home screen.pdf` and its `-1`/`-2`/`-3` variants (re-read
directly this phase — the discovery that these files depict the Spensa
surface, not the dashboard, is itself this phase's headline finding,
resolved by the user's explicit Section-0 lock: "HOME = primary
financial dashboard, SPENSA = dedicated AI financial-brain/chat
surface"). All three static-state variants show the same five chips
under the ask-input: "Add an expense," "Add income," "Show account
balances," "See this month's summary," "How much can I spend?"

**CURRENT (before this phase)**: `spensa-chat.tsx`'s empty state showed
only a title and a description sentence — no starter chips at all.

**DIFFERENCE**: A real, reference-evidenced affordance was missing.

**WHY IT MATTERS**: NN/g Heuristic #6 (recognition over recall) — a
first-time user facing a blank "Ask me about your money…" box has to
invent a useful question from nothing. The reference's chips remove
that blank-page problem entirely.

**SEVERITY**: P1.

**DECISION**: Implement verbatim.

**IMPLEMENTATION**: Added the five chips to the empty state in
`spensa-chat.tsx`. Each chip calls the exact same `handleSend` path a
typed message would (refactored to accept an optional override string)
— there is no separate, silent code path, preserving this file's own
documented anti-pattern rule ("no ambiguous 'this looks like navigation
but actually mutates' quick reply"). A mutation-shaped prompt like "Add
an expense" still requires its own downstream confirmation step, exactly
as a typed message would.

**LIVE VERIFICATION**: Signed up a fresh test account, navigated to
`/spensa/new`, confirmed all five chips render with the exact reference
copy, clicked "Show account balances," confirmed it sent as a real user
message and correctly surfaced the product's existing "Connect an AI
provider" error state (no fake response — no AI provider is configured
in this environment, and none was fabricated). Test account deleted
afterward, confirmed gone via the Supabase admin API.

## Finding 2 — The Home/Spensa routing question (VERIFIED, resolved by explicit user decision)

Documented in full in `docs/phase-37/product-decisions.md`. Summary:
re-reading `Home screen.pdf` and its variants revealed they depict a
Spensa-conversational landing experience, not a financial dashboard —
raising a genuine, foundational question about which route ("/home" or
"/spensa") the reference actually intended as the app's landing screen.
This was escalated to the user rather than resolved unilaterally, given
the scale of a wrong guess in either direction. The user's own Phase 37
mandate locks the answer: Home stays the dashboard, Spensa stays the
dedicated AI surface. Not reopened.

## Finding 3 — `security_smoke.sh`'s fixture-cleanup gap (VERIFIED, already fixed)

Documented as a known P3 test-hygiene gap in Phases 34/35/36's own
reports (a leftover `oauth_clients` row caused a false-negative on the
NEXT run's registration check). Confirmed this phase, via `git diff`,
that this was already fixed during Phase 36's own session (a DELETE
cleanup step added after the registration check, comment dated "Phase
36 fix"). Re-verified this phase: the full `security_smoke.sh` run came
back 229/229 clean on the very first attempt, with no manual cleanup
needed beforehand — confirming the fix holds.

## Not re-audited this phase

Transactions, Budgets, Accounts (beyond the routing/Spensa findings
above), and the full Cash Flow pixel-region sweep were not re-inspected
against their reference PDFs from zero this phase. See
`reference-screen-matrix.md` for exactly what is CARRIED FORWARD versus
newly VERIFIED.
