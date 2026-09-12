<title>Phase 37 — Reference-to-Screen Matrix</title>

# Phase 37 — Reference-to-Screen Matrix

Per Section 1's own instruction, this covers every reference relevant to
the named screens, built by directly re-inspecting the reference files
and the current running app — not carried forward from a prior phase's
claim without re-checking. Where a cell says CARRIED FORWARD, the
underlying finding was re-confirmed live earlier in this engagement
(cited) and not re-derived from zero this phase, per this phase's own
proportionality rule (Section 31: "if something already matches, leave
it alone").

| REFERENCE FILE | REFERENCE SCREEN | CURRENT ROUTE | CURRENT COMPONENT | REFERENCE STATE | CURRENT STATE | MATCH | SEVERITY | ACTION |
|---|---|---|---|---|---|---|---|---|
| `Home screen.pdf`, `-1`, `-2`, `-3` | Spensa conversational landing (title "I'm Spensa", ask-input, 5 starter chips, "Complete your setup" checklist) | `/spensa/[conversationId]` | `spensa-chat.tsx` | Empty conversation | Empty conversation (before this phase's fix) | **MISMATCH → FIXED** | P1 | Added the 5 starter-prompt chips verbatim this phase; see `reference-audit.md` Finding 1 |
| (same files) | — | `/home` | `home-content.tsx` | N/A — **file name is misleading; content is the Spensa surface, not a dashboard** | Traditional financial dashboard | **LOCKED, not a mismatch** | — | Per the user's own explicit Phase 37 instruction: "HOME = primary financial dashboard, SPENSA = dedicated AI financial-brain/chat surface... do not revisit." Recorded, not reopened. |
| `Cash Flow.pdf`, `-1`, `Recent Transactions-1`, `Overview.pdf`/`-1`/`After Budget` | Cash Flow workspace (header/toolbar/insight/transactions+donut+budget panel, no global Safe-to-Spend hero) | `/cash-flow` | `cash-flow-overview.tsx` | Populated, no-budget and with-budget states | Matches (Phase 35 fix) | MATCH | — | CARRIED FORWARD (Phase 35, re-confirmed live with real transaction data this session's own prior phase) |
| `Goal Creation.pdf`, `-1` | Conversational goal wizard | `/goals` (wizard sheet) | `goal-wizard-sheet.tsx` | Category → destination → cost estimate → savings → date → account → summary → create | Matches | MATCH | — | CARRIED FORWARD (Phase 33) |
| `Goals-6.pdf` | Goal detail with Spensa insight card | `/goals` (detail dialog) | `goal-detail-dialog.tsx` | Insight sentence present, Privacy-Mode-aware | Matches | MATCH | — | CARRIED FORWARD (Phase 34) |
| `Settings/Accounts.pdf` + `-1`..`-5` | Account list, add/edit forms | `/settings/accounts` | `account-list.tsx`, `add-account-sheet.tsx` | Bank/Cash/Credit Card/Investment tabs, type-appropriate fields | Matches structurally (spot-checked Bank + Credit Card creation live, Phase 35) | MATCH (partial coverage) | P2 | Cash/Investment creation forms not re-verified live this phase; not re-touched |
| `Credit Card.pdf`, `-1`..`-3` | Credit card detail (limit, outstanding, available credit) | `/settings/accounts` | `account-card.tsx` | Distinct Credit Limit / Outstanding / Available Credit fields; no Payment Due or Billing Date shown | Matches the fields shown; Payment Due/Billing Date genuinely unsupported | MATCH (scope-limited) | — | See `financial-language-audit.md` — correctly NOT faked |
| `Cash Flow - Upcoming Bills.pdf`, `Upcoming Bills.pdf`/`-1` | Date-grouped bills, "Yet to spend" subtotal | `/cash-flow` (Upcoming Bills tab) | `cash-flow-overview.tsx` | Present | CARRIED FORWARD (Phase 30B), not re-verified live this phase | INFERRED MATCH | P3 | Low priority — no evidence of regression |
| `Edit Budget.pdf`, `-1`, `Setup budget limits.pdf` | Recurring budget, apply-to-upcoming-months, override | `/cash-flow/budgets` | `edit-budget-sheet.tsx` | Present | CARRIED FORWARD, not re-verified live this phase | INFERRED MATCH | P2 | Continue in a future pass |
| `Spensa Brain.pdf`, `-1`..`-5` | AI provider settings | `/settings/ai` | provider-settings components | Anthropic/OpenAI/Gemini selection | Code-level match confirmed (`IMPLEMENTED_PROVIDERS`); UI not re-walked live this phase | INFERRED MATCH | P2 | Continue in a future pass |
| `Chat Exp.pdf` + variants, `Spensa Reply with Quick reply buttons.pdf`/`-1` | In-conversation quick-reply buttons on Spensa's OWN responses (not the empty-state starters) | `/spensa/[conversationId]` | `spensa-chat.tsx` | Present in some conversation turns | **NOT IMPLEMENTED** — Spensa's text replies never include reply-shaped quick actions mid-conversation | MISMATCH | P2 | Deferred this phase — building this correctly needs live model tool-calling output shaped as suggested replies, a real feature-design task, not a copy-paste fix; documented, not faked |

## Variants not separately re-audited this phase

EMPTY/POPULATED states were exercised live for Cash Flow (Phase 35) and
Spensa (this phase). PRIVACY ON/OFF was exercised live for Goal Detail
(Phase 34) and the product-wide Privacy Mode toggle (Phase 32). ERROR
state was exercised live this phase (Spensa's "no provider configured"
message, triggered by a real starter-chip click). MOBILE/DESKTOP were
spot-checked at the Browser pane's own default and an explicit
1280×900 size in Phase 35; a full 320–1280px sweep remains open (see
`responsive-audit.md`).
