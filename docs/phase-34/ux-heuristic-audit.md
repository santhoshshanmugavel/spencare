<title>Phase 34 — Nielsen Norman Heuristic Audit</title>

# Phase 34 — NN/g 10-Heuristic Audit

Per Section 3's own instruction, this is not a generic UX essay — every
row below is a real, observed issue or a real, observed pass in THIS
product, checked live this phase or carried forward with its own
evidence from an earlier phase's live check (cited).

| SCREEN | HEURISTIC | PROBLEM / OBSERVATION | USER IMPACT | SEVERITY | FIX / STATUS | VERIFICATION |
|---|---|---|---|---|---|---|
| Goal Detail | #2 Match between system and real world | The dialog showed saved/target/pace numbers but no plain-language sentence tying them together, unlike every other financial surface in the product (Cash Flow's insight banner, Home's "Needs your attention"). | A user could see the numbers but not immediately answer "am I on track?" without doing the subtraction/division themselves. | P1 | Fixed this phase — see `docs/phase-34/reference-audit.md` Finding 1. | Live browser verification + `goal-insight.test.ts` + `goal-detail-dialog.test.tsx`. |
| Data & Backup → Delete account | #5 Error prevention | Destructive, irreversible action. | A one-click delete would be catastrophic and unrecoverable. | — (PASS) | Already correct: named consequence list + type-your-email re-verification before the action fires. | Live-clicked through the full flow this phase; confirmed the account was actually gone (login page's own "Your account has been deleted." message), matching `security_smoke.sh`'s automated proof that every user-owned table is emptied. |
| Cash Flow → Budgets (no budget yet) | #8 Aesthetic and minimalist design / #6 Recognition rather than recall | Right-column budget card shows a `Set up budgets` CTA rather than an empty progress bar or a budget UI with nothing behind it. | User isn't shown a confusing "0 of ₹0" bar; the CTA tells them exactly what to do next. | — (PASS) | Confirmed correct this phase. | Live screenshot, fresh account. |
| Home (near-empty account) | #1 Visibility of system status / #9 Error recovery | Empty state names the feature and the next action ("Add transactions to understand your spending") rather than a bare "No data." | User isn't left guessing why a section is blank. | — (PASS) | Confirmed correct this phase. | Live screenshot, fresh account. |
| Privacy Mode toggle (nav rail) | #4 Consistency and standards | In this local dev environment, the Next.js dev-mode indicator badge visually overlaps the nav rail's bottom-left toggle position at some viewport sizes, occasionally intercepting a click meant for the toggle. | Confusing during **local development only** — clicking near the toggle can open the Next.js dev panel instead. | P3, disclosed, not a product defect | Not fixed (a dev-tool artifact, first documented in Phase 32; confirmed again this phase; does not render in production). The Settings → Privacy full switch is unaffected and was used as the reliable path for this phase's own verification. | Reproduced live this phase; root-caused the same way Phase 32 did (the overlay is `NEXTJS-PORTAL`, not app markup). |
| Goal Wizard (all categories) | #6 Recognition rather than recall / #3 User control and freedom | Every step offers "Enter my own" alongside suggested chips; "Adjust Plan" returns to the amount step without discarding the category/name already chosen. | User is never forced to accept a suggested number or restart the whole conversation to change one figure. | — (PASS, Phase 33's own work) | No change needed. | Re-confirmed structurally by reading the code this phase; not re-driven live (Phase 33's own report already has full live verification). |
| Goal Wizard, zero funding accounts | #9 Help users recognize, diagnose, and recover from errors | Rather than a disabled "+ Create goal" button with no explanation, the wizard walks the whole conversation and only asks to connect an account at the funding-account step, with a real link. | User understands WHY they need an account, at the exact point it matters, instead of hitting a dead, unexplained disabled button up front. | — (PASS, Phase 33's own work) | No change needed. | Re-confirmed structurally; Phase 33's own live verification already covers this branch. |

## Heuristics not newly evaluated this phase

#7 (Flexibility and efficiency) and #10 (Help and documentation) were not
specifically probed this phase beyond what's already documented in
`docs/phase-31/ux-quality-audit.md`'s own "Coverage honesty" section — no
new finding to report either way.
