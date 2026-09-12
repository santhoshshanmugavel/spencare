<title>Phase 38 — Responsive</title>

# Phase 38 — Responsive

## New surfaces this phase

Both new elements (`NoEligibleAccounts`'s message+link, the credit-card
helper note) are plain block-level text inside the same `Sheet` +
`space-y-4` form container every other field in this sheet already uses
— no new layout primitive, no fixed widths, no new responsive risk.
`<Button asChild className="w-full">` reuses the exact same
full-width-button pattern the sheet's own submit buttons already use.

## Not re-swept this phase

A full 320–1280px breakpoint sweep was not run this phase — the two
fixes are text-only additions to an existing, already-responsive form,
which is why a full re-sweep was judged unnecessary rather than skipped
by oversight. The one unconfirmed observation from Phase 37 (Settings'
possible narrow-width overflow) was not revisited this phase — it
remains open, still unconfirmed, still recommended as a dedicated future
check per `docs/phase-37/responsive-audit.md`.

**Live-verified at the Browser pane's default size** (confirmed
functionally correct: chips/guard/note all rendered readably, no
observed clipping or overflow) — not a substitute for a full breakpoint
sweep, but the only responsive check actually performed this phase.
