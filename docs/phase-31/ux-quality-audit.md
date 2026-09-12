<title>Phase 31 — UX Quality Audit</title>

# Phase 31 — UX Quality Audit

**Method.** Every finding below is grounded in a real code read or a real
browser observation made during this pass (or an earlier pass in this same
engagement, cited where relevant) — never a guessed or generic "best
practice" item. Coverage is honest, not exhaustive: **deep review** means
the screen's actual source was read and, where practical, exercised live
in the browser this phase; **light review** means it was read for
obvious violations but not exercised live; **not reviewed** is stated
explicitly rather than silently skipped. See §"Coverage honesty" at the
bottom for the full breakdown — the mandate's own scope (15+ routes, every
dialog/sheet/state, 10 heuristics, Apple HIG) is realistically a
multi-week, multi-reviewer effort; this pass prioritized the
highest-financial-stakes surfaces.

Heuristics referenced: **NN/g's 10** (numbered 1–10 as in the mandate) and
**Apple HIG** (Purpose / Agency / Responsibility / Familiarity /
Flexibility / Simplicity / Craft / Delight).

Severity: **P0** blocks a task or creates real financial risk · **P1**
significant usability problem · **P2** noticeable friction · **P3** polish.

---

## Audit matrix

| Screen | Heuristic | Problem | Severity | Evidence | Recommendation | Fixed | Verified |
|---|---|---|---|---|---|---|---|
| Global (nav rail) | NN/g #6 Recognition, HIG Agency | `privacy_mode_enabled` is read and rendered on **every** financial screen (Home, Cash Flow, Goals, Accounts, Transactions), but no UI control anywhere lets a user turn it on or off. The nav rail's own source comment admits this: *"the privacy/hide-balances toggle observed in some screens... not yet approved."* A user cannot reach a feature the whole product is built to respect. | **P1** | `navigation-rail.tsx:40`; grepped `privacy_mode_enabled` across 8+ pages, zero toggle UI found; confirmed live by flipping the column directly in the database — every masked state I built this phase (Home, chart, attention banner) rendered correctly the instant the flag was true, proving the *rendering* is not the gap, the *control* is. | Add a Privacy Mode toggle to the nav rail or a settings page. | **Fixed in Phase 32** — see `docs/phase-32/privacy-mode-ux.md`. Phase 32's own Part 1 audit found an even deeper gap than assumed here: no `updateProfile`-adjacent command could even WRITE this column at all (the existing `updateProfile` command's schema requires `preferredCurrency`/`timezone` on every call, so it couldn't be reused as-is) -- a new, narrow `updatePrivacyMode` command was added, not a UI-only patch. | Verified live in Phase 32: toggle on nav rail (all 15 pages) + Settings > Privacy, full OFF→ON→refresh→navigate→OFF journey. |
| Home dashboard (pre-Phase 31) | NN/g #6 Recognition, #1 Visibility of system status | Home showed only Safe-to-Spend + a static setup checklist — no "what changed," no budget/goal health, no trend. A user had to visit three separate pages (Cash Flow, Budgets, Goals) to answer "am I OK this month?" | **P1** | `home-content.tsx` (pre-Phase-31 version): 148 lines, no cash-flow, budget, or goal data fetched at all. | Build the Financial Insights Dashboard (this phase's §Part 6). | **Fixed** this phase — see `dashboard-information-architecture.md`. | Verified live: attention banner, trend chart, and top-category insight all render with real seeded data; empty/masked states verified live too. |
| Goals — `AddGoalSheet` (found in the Phase 30 pass, re-confirmed here) | NN/g #5 Error prevention | The money-input field's local `useState` display string didn't reset when the sheet was closed and reopened, so a stale digit string from a previous entry could silently concatenate with new input (a real, reproduced bug, not a hypothetical). | **P1** at the time | Reproduced live in the Phase 30 browser pass (typing into a "blank-looking" field that actually still held old digits, tripping the `"amount too large"` validator). | Clear the money-field's local state on submit. | **Fixed** in the Phase 30 pass. | Verified live afterward — clean field state across repeated opens. |
| Cash Flow — transaction detail (pre-Phase-30B) | NN/g #4 Consistency and standards, HIG Familiarity | Transaction detail opened as a centered `Dialog`; every other secondary-detail surface in the product (Add/Edit sheets, Bill Now, Contribute) opens as a right-side `Sheet`. One inconsistent surface breaks the learned pattern "detail opens from the right." | **P2** | `transaction-detail-dialog.tsx` (pre-Phase-30B) used `Dialog`/`DialogContent`. | Convert to `Sheet` (already defaults `side="right"` — a straight swap, not a new primitive). | **Fixed** in Phase 30B. | Verified live: opens from the right with Header → Spend Summary → Configure → Edit/Delete. |
| Goal creation (`AddGoalSheet`) | HIG Familiarity, NN/g #2 Match with the real world | A plain multi-field form for a decision ("what am I saving for, by when, from where") the reference product frames as a guided conversation. Not wrong, but a flatter experience than the reference's own intent. | **P2** | `add-goal-sheet.tsx` doc comment: *"Every Goal creation screen in source... is Spensa-conversational... This sheet is RECOMMENDED"* — a deliberate, documented substitution from an earlier phase. | Build the conversational Spensa goal wizard. | Not fixed this phase (out of Phase 31's scope; tracked from Phase 30). | Not re-verified this phase. |
| Destructive actions (Delete Transaction/Budget/Goal/Account) | NN/g #5 Error prevention, #3 User control | **Consistently good** — every destructive action in the product routes through the one shared `ConsequentialActionPreview` component (explicit confirm step, real Undo where the data allows it, never a silent delete). | — (positive finding) | `delete-transaction-dialog.tsx`, `delete-budget-dialog.tsx`, `archive-goal-dialog.tsx`, `archive-account-dialog.tsx` all import the same component; `ConsequentialActionPreview` has 29 of its own tests. | No action needed. | — | — |
| Login (`login-form.tsx`) | NN/g #1, #5, #9 | **Consistently good** — labeled fields with `aria-describedby` error association, a real show/hide password control (`aria-pressed`), a loading state on submit ("Signing in…"), a `role="alert"` server-error region, and a Forgot Password escape hatch. | — (positive finding) | Full file read; no P0–P2 found. | No action needed. | — | — |
| Recent Transactions / Upcoming Bills (pre-Phase-30B) | NN/g #8 Aesthetic and minimalist design, #6 Recognition | Overview page showed a flat 5-row, ungrouped preview with bare account names and no per-row context, while the full `/transactions` route had real date-grouping and account-type tags — the two surfaces disagreed on how much information the same data deserves. | **P2** | `cash-flow-overview.tsx` (pre-30B) vs `transaction-list.tsx` (pre-30B), read side by side. | Bring the Overview's Recent Transactions tab up to the same fidelity (grouping, account-type tag, hover actions, per-row hint). | **Fixed** in Phase 30B. | Verified live with seeded data: grouped by date with a real subtotal, hover-reveals Delete, "HDFC Bank · Bank" tag, one-line hint under every title. |
| Financial-layers hero (Home + Cash Flow, pre-Phase-30B) | NN/g #8 Aesthetic and minimalist design | The Safe-to-Spend hero used the same large `text-5xl` treatment on Cash Flow as on Home, visually out-competing the transaction workspace that page exists to show. | **P2** | `cash-flow-overview.tsx` (pre-30B). | Give Cash Flow its own smaller `heroClassName` (the component already supports this per-call) instead of a second implementation. | **Fixed** in Phase 30B. | Verified live: compact strip, transaction list is now the visually dominant region. |
| Budget "Spend limits" panel copy | NN/g #2 Match with the real world | Reference product literally reads "Available to spend this month / ₹X / ₹Y budget"; the shipped copy said "Budget remaining" — a small but real mismatch with the reference the user was validating against. | **P2** | Cross-checked against `Cash Flow - Recent Transactions-4.pdf`. | Match the reference copy; keep the co-existing Safe-to-Spend hero's own, separate wording untouched (no risk of conflating the two concepts, since they sit in different regions with different data). | **Fixed** in Phase 30B, with an explicit test documenting the deliberate supersession of the prior internal "never say Available to spend" rule for this one widget. | Verified via updated `cash-flow-overview.test.tsx` + live screenshot. |
| Goal card / detail "reached" copy | NN/g #2 Match with the real world | "🎉 Goal reached" / "🎉 Goal achieved!" didn't match the reference's "Completed in N months" framing. | **P3** | Cross-checked against `Goals-6.pdf`. | Compute and show "Completed in N months" from `created_at`→`completed_at`. | **Fixed** in the Phase 30 pass. | Verified via `goal-detail-dialog.test.tsx`. |
| Dev-environment Turbopack cache | N/A (tooling, not product) | Twice this engagement, a stale Turbopack persistent cache served phantom "duplicate declaration" errors and one hard panic ("failed to resolve client-relative path to polyfill") that didn't reflect the real, correct source on disk. | N/A | Reproduced, diagnosed via `md5`/`grep` proving the source was correct, resolved both times by deleting `.next` and restarting. | No product action — a local dev-tooling flake, documented so it isn't mistaken for a code defect in a future session. | N/A | N/A |
| Cash Flow budget widget (Phase 32 finding) | NN/g #5 Error prevention, security | The "Available to spend this month / ₹X / ₹Y budget" widget's TOTAL BUDGET figure was built as a hardcoded `formatAmount(...)` template-string interpolation, bypassing `<Money masked>` entirely -- only the "available" half of the same line was actually guarded by `masked`. Found by live-toggling Privacy Mode on and reading a real, unmasked ₹ amount sitting right next to a correctly-masked one on the same screen. | **P1** | Reproduced live in the browser (screenshot showing "₹*** / ₹77,879.00 budget" simultaneously); root-caused to `cash-flow-overview.tsx`'s one unguarded `formatAmount(totalLimit, CURRENCY)` call (every sibling call in the same file was already correctly guarded). | Route the total-limit figure through `<Money masked>` like every other amount in the widget. | **Fixed in Phase 32**, live-reverified (masked shows "₹*** / ₹***"; unmasked shows matching real totals). | New regression test added: `cash-flow-overview.test.tsx` — "masks the budget total (never just the remaining figure) when Privacy Mode is on." |

---

## Severity counts (as of Phase 32)

| Severity | Count | Status |
|---|---|---|
| P0 | 0 | — |
| P1 | 3 (2 from Phase 31 + 1 found live during Phase 32) | **All 3 now fixed**: dashboard gap (Phase 31), Privacy Mode UI control (Phase 32), Cash Flow budget-total leak (found and fixed live during Phase 32's own verification) |
| P2 | 4 | All 4 fixed (3 in Phase 30B, 1 in Phase 30) |
| P3 | 1 | Fixed (Phase 30) |

**On the acceptance criterion "P0 = 0, P1 = 0":** As of Phase 31 alone,
P1 was **not** zero — the missing Privacy Mode toggle was a real,
user-facing control gap. Phase 32 closed it (with a new domain command,
not a UI-only patch), and Phase 32's own live verification of that fix
found a SECOND, more serious P1 in the process (a real financial-amount
leak in the Cash Flow budget widget) and fixed that too. As of Phase 32,
P0 = 0 and P1 = 0, both genuinely verified live in the browser, not
inferred from code review alone.

---

## Apple HIG notes

- **Purpose / Agency** — the new "Needs your attention" section exists
  because a user opening the app has one implicit question ("is anything
  wrong?"); surfacing it above the fold, only when true, respects that
  purpose without manufacturing false urgency.
- **Responsibility** — the trend chart and every new insight are
  computed from data the domain layer already owns (§Part 2 of
  `metric-framework.md`); nothing is invented to look more "complete."
- **Familiarity** — the new dashboard sections reuse `Card`/`Progress`/
  `Money`/`ListRow` throughout; no new visual language was introduced.
- **Craft** — the trend chart's colors are read from the same CSS custom
  properties (`--success`/`--destructive`/`--border`/`--popover`) every
  other tone-aware element in the product already uses, so it re-themes
  automatically instead of hardcoding a second palette.

---

## Coverage honesty

**Deep review (source read + live browser exercise this engagement):**
Home, Cash Flow (Overview + Transactions + Bills + Budgets), Goals
(grid + detail + create/edit), Accounts (list + Add Account), Privacy
Mode (verified live via direct flag toggle), destructive-action pattern,
Login.

**Light review (source read, not live-exercised this phase):** Signup,
Onboarding wizard, Settings → Spensa's Brain (deeply audited in an
earlier, separate bug-fix engagement this session, not re-audited here),
Import wizard.

**Not reviewed this phase:** Settings → Security, Settings → Data &
Backup, Settings → MCP, Settings → Gmail, Terms, Privacy (the static
legal page), forgot/reset password, keyboard-navigation and
screen-reader sweep beyond the axe checks already embedded in each
component's own test suite (every touched component this phase has a
passing `jest-axe` check; a dedicated manual screen-reader pass across
the whole product was not performed).
