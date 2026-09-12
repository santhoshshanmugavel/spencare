<title>Phase 37 — Design System Audit</title>

# Phase 37 — Design System Audit

## Method

Checked the actual token/component source (`apps/web/app/globals.css`,
`apps/web/app/layout.tsx`, `apps/web/components/ui/*`) directly this
phase rather than assuming from a prior report.

## Typography — VERIFIED

`layout.tsx` loads Google Sans Flex via `next/font/google` and wires it
to `--font-sans` (self-referencing so Tailwind's `@theme inline` can see
it, per the file's own documented workaround for a real `next/font`
limitation, found and fixed in Phase 23). `--font-heading` aliases to
the same family — confirmed, not a second, drifting font declaration.

## Radius — VERIFIED

A single `--radius: 0.625rem` base token drives `--radius-sm` through
`--radius-4xl` via consistent multipliers (0.6× to 2.6×) — one source of
truth, no components found hardcoding an arbitrary `border-radius`
value outside this scale during this phase's own work (the new Spensa
chips use `rounded-full`, a Tailwind utility, not a magic number).

## Components reused this phase, not reinvented

The Phase 37 fix (`spensa-chat.tsx`'s starter chips) reused the existing
`Button` component (`variant="outline" size="sm" className="rounded-
full"`) — the exact same chip pattern already established in
`goal-wizard-sheet.tsx` (Phase 33). No new button variant, no new chip
component, no one-off CSS.

## Not re-audited from zero this phase

A full inventory of every shadow/border/color token across every
screen was not re-run this phase — Phase 30-32's own design-system
observations (Cash Flow's insight-card border/background pattern,
`Card`/`Sheet`/`Dialog`/`Tabs` primitives) were reused as evidence where
directly relevant (see `reference-audit.md`) rather than re-derived.

## Findings

None found this phase requiring a fix — the one new UI surface added
(Spensa's starter chips) was built entirely from existing tokens and
existing component patterns, which is itself the correct outcome of a
"prefer shared components" audit, not a gap.
