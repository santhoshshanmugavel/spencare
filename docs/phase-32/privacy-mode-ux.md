<title>Phase 32 — Privacy Mode UX</title>

# Phase 32 — Privacy Mode UX

## Problem

`profiles.privacy_mode_enabled` and its masking (`<Money masked>`, chart
suppression, AI-context redaction) were built and correctly wired across
the product in earlier phases — but nothing let a user actually turn it
on. The Phase 31 audit found this; this phase's own Part 1 inspection
found it was worse than assumed: there was no *command* to write that
column at all outside a full profile-settings save. A user could not
reach a feature the entire product was built to respect.

## User need

"I want to glance at my finances in a public or shared space without
someone next to me reading exact numbers, and I want to turn that
protection on and off in one tap, from wherever I already am."

## UX rationale

Two renderings of one piece of state, matching the mandate's own
two-surface framing:

- **Fast access** (nav rail): a persistent icon button, always reachable,
  no navigation required. Rejected: a labeled switch row in the rail —
  the rail is a fixed 64px column and a text label would either truncate
  or force widening the whole rail for one control.
- **Understanding** (Settings > Privacy): a full row with the "Privacy
  Mode" label, an explicit "On — amounts are hidden." / "Off — amounts
  are visible." sentence, and three short cards naming exactly what's
  affected (Financial amounts / Charts / Spensa) — each one verified
  against the real redaction code, not asserted from the feature's name.

**Why the rail control isn't "an unexplained icon-only control"** (the
mandate's own explicit prohibition): it has a real accessible name that
states the CURRENT state and the ACTION ("Privacy Mode is off. Turn
on."), a tooltip on hover naming it plainly ("Privacy Mode: On/Off"),
and a visually distinct active state (the same solid-highlight treatment
every other active rail icon already uses, plus the icon itself swaps
Eye ↔ EyeOff). A sighted user gets three independent signals (tooltip,
icon shape, highlight); a screen-reader user gets a stated name and
state — never "here's an eye icon, guess what it does."

## Interaction model

1. Click/tap the toggle (either surface).
2. Local state flips immediately (optimistic).
3. `updatePrivacyModeAction` is called server-side.
4. On success: a confirmed toast ("Privacy Mode turned on/off."),
   `router.refresh()` re-runs every Server Component on the current
   route so already-rendered `masked` props update in place.
5. On failure: the local state reverts to what it was before the click,
   an error toast explains it, and the user is never left looking at a
   toggle that claims a state the server didn't actually save.

## Visual placement

- Nav rail: `extraFooterSlot`, between the last nav icon and the
  (currently unused) avatar slot — a slot `navigation-rail.tsx` already
  reserved for exactly this, unfulfilled since an earlier phase.
- Settings: a new "Privacy" entry in `SettingsNav`, positioned right
  after "Profile" (an identity/preferences cluster), before "Security."

## State model

Single source of truth: `profiles.privacy_mode_enabled` in the database.
No client-only or cookie-based state exists for it — every page that
reads it (`getProfile`) does so fresh on every server render. This is
why persistence across navigation, refresh, and login needs no special
handling: there is nothing session-scoped to lose.

## Failure behavior

`updatePrivacyMode`'s `Result` type is checked explicitly; a failed
write reverts the optimistic UI state and shows `toastError` with the
command's own message ("Couldn't update Privacy Mode. Try again.") —
never a silent failure, never a toggle left showing a state that isn't
actually persisted. Covered by an explicit test:
`privacy-mode-toggle.test.tsx` — "REVERTS the optimistic state and shows
an error toast when persistence fails."

## Accessibility

- Rail toggle: `role="switch"`, `aria-checked`, and a STATE-DEPENDENT
  `aria-label` ("...is off. Turn on." / "...is on. Turn off.") — the
  accessible name itself communicates both current state and the
  resulting action, not just a static label.
- Settings toggle: a real Radix `Switch` (`ui/switch.tsx`, new this
  phase, built from the same `radix-ui` package every other primitive in
  this codebase already uses) with `aria-label="Privacy Mode"` plus an
  adjacent, always-visible text sentence stating the state in words —
  redundant by design, so the state is never conveyed by switch position
  alone.
- Both variants: axe-clean in both states (`privacy-mode-toggle.test.tsx`,
  `privacy-explainer.test.tsx`).

## Security considerations

- `updatePrivacyMode` never accepts or trusts a client-supplied user id
  — `AuthContext.userId` comes from the verified session, same as every
  other command in this codebase.
- The command is classified non-consequential (a display/masking
  preference, not a financial or destructive action) — no confirmation
  cascade needed, matching the same reasoning `archiveGoal`/
  `archiveAccount` already use for non-destructive metadata changes.
- `revalidatePath("/", "layout")` deliberately invalidates the ENTIRE
  route tree on every toggle, rather than a hand-maintained list of the
  ~10 routes that currently read this flag — a new masked page added
  later is covered automatically, not left stale until someone remembers
  to add it to a list.

## Privacy behavior (what's actually redacted — verified, not assumed)

Every claim in the Settings > Privacy explainer was checked against the
real implementation before being written as UI copy:

| Claim in the UI | Verified against |
|---|---|
| "Balances, spending, budgets, and goals are hidden across Home, Cash Flow, Goals, and Accounts." | Live-toggled and screenshotted all four surfaces this phase (see §Browser verification). |
| "Financial charts are hidden rather than shown with sensitive values." | `cash-flow-trend-chart.tsx`'s own masked branch renders a text notice, never the chart, when masked (already true since Phase 31; re-verified live this phase). |
| "Spensa's responses are protected from exposing exact financial amounts while Privacy Mode is on." | `packages/ai/src/context.ts`'s `buildAiContext` redacts every monetary field via `redactFinancialSnapshot`/`redactBudgetSummaries`/`redactGoalSummaries`/`redactBillSummaries`/`redactCashFlowSummary` BEFORE the model ever sees them — not just "the model is told not to repeat numbers." Covered by `context.test.ts`'s own dedicated suite, "buildAiContext — Privacy Mode ON (the critical security guarantee)": "the serialized AiContext contains NO real monetary figure anywhere." |

**A real leak was found and fixed during this verification**, not
predicted from code review: Cash Flow's "Available to spend this month"
widget showed its total-budget figure unmasked while the adjacent
remaining-amount figure was correctly masked, because that one figure
was built as a raw string interpolation instead of routing through
`<Money masked>`. See `docs/phase-31/ux-quality-audit.md`'s new finding
row and the regression test added to `cash-flow-overview.test.tsx`.

## Testing

- `packages/domain/application/src/commands/updateProfile.test.ts` — 5
  new tests for `updatePrivacyMode` (validation rejection, on, off,
  write-failure surfaced as a real error, non-consequential
  classification).
- `apps/web/components/spencare/privacy-mode-toggle.test.tsx` — 10 tests
  covering both variants: accessible name/state, immediate visual
  feedback, success toast + refresh, failure rollback + error toast, axe.
- `apps/web/app/settings/privacy/privacy-explainer.test.tsx` — 4 tests:
  purpose sentence present, all three "what's affected" sections present,
  the full toggle renders with its state sentence, axe-clean.
- `apps/web/components/spencare/settings-nav.test.tsx` — updated for the
  new "Privacy" entry (order, route, no regression to the existing 7).
- `apps/web/app/cash-flow/cash-flow-overview.test.tsx` — new regression
  test for the budget-total leak found live.

## Browser verification

Performed against the real running app (local Supabase + seeded test
data), not simulated:

1. Toggled Privacy Mode OFF → ON via Settings > Privacy's full switch.
2. Confirmed toast, immediate masking on the SAME page (via
   `router.refresh()`), no full reload needed.
3. Navigated to Home, Cash Flow, Cash Flow > Budgets, Cash Flow >
   Transactions, Goals, Settings > Accounts — every real amount
   (balances, Safe-to-Spend, budget figures, transaction amounts, goal
   saved/target) showed `₹***` or an equivalent masked string; non-
   monetary text (merchant names, category names, account names, dates)
   remained visible, as intended.
4. Found and fixed the Cash Flow budget-total leak during this pass
   (§Privacy behavior above).
5. Hard-refreshed the page (`window.location.reload()`) — masked state
   persisted (expected: it's re-read from the database on every server
   render, nothing to lose).
6. Navigated away (Settings > Privacy) and back (Cash Flow) — masked
   state persisted across both the rail and Settings toggles, both
   reading the same underlying column.
7. Toggled OFF again from Settings > Privacy — every real number
   returned correctly (Safe to Spend, budget totals, transaction
   amounts all matched their pre-mask values).
8. Login/logout was not separately exercised: the state is DB-backed
   with no session-scoped component, so a fresh login re-reads the same
   row by construction — there is no code path that could make login
   behave differently from the refresh/navigation cases already
   verified.

## Known limitation, disclosed

Spensa's redaction (`buildAiContext`) is verified via its own existing,
passing automated test suite (`context.test.ts`), not by sending a live
message through the Spensa chat UI this phase — doing so would require a
connected AI provider, and this session's standing rule (established
earlier in this engagement) is to never handle, test with, or enter a
user-supplied API key. The automated coverage is strong (it asserts "no
real monetary figure anywhere" in the exact object structure sent to the
model), but a live end-to-end chat message was not sent.
