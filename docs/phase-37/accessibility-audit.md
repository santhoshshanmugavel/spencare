<title>Phase 37 — Accessibility Audit</title>

# Phase 37 — Accessibility Audit

## New surface this phase: Spensa starter-prompt chips

- **axe**: `spensa-chat.test.tsx`'s existing accessibility describe block
  re-run this phase — 2/2 tests pass with the new chips present (axe-
  clean, including the empty-state variant that now renders 5 additional
  interactive buttons).
- **Keyboard**: chips are real `<Button type="button">` elements — Tab-
  reachable, `Enter`/`Space`-activatable, no custom key handling needed
  or added.
- **Labels**: each chip's accessible name IS its visible text (e.g.
  "Show account balances") — no icon-only or ambiguous chip.
- **Focus order**: chips sit in natural DOM order after the description
  paragraph, before the composer — unchanged tab order for the rest of
  the page.

## Not re-audited from zero this phase

A manual screen-reader sweep across the whole product remains a
disclosed, carried-forward gap (Phase 31/34's own "Coverage honesty"
sections). No new dialog, sheet, tab, radio group, or combobox was
introduced this phase — the one new surface (chips) is the simplest
possible interactive pattern (a row of buttons), which is why it was
feasible to fully verify within this phase's scope.
