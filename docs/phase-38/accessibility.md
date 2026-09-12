<title>Phase 38 — Accessibility</title>

# Phase 38 — Accessibility

## New surfaces this phase

**`NoEligibleAccounts`** (the zero-eligible-accounts guard): a plain
paragraph plus a real `<Link>` rendered via `<Button asChild>` — no
custom interactive semantics needed, inherits the existing Button/Link
accessible-name and focus behavior.

**Credit-card helper note**: a plain `<p>`, no interactivity, no ARIA
needed.

## Verified

`add-transaction-sheet.test.tsx`'s existing accessibility describe block
re-run this phase — 3/3 axe tests pass with both new surfaces present
(including the empty-account-guard state specifically, which is a new
DOM shape axe hadn't checked before).

**Keyboard**: the `Add an account` link is a real anchor — Tab-reachable,
`Enter`-activatable, no custom handling. The helper note is not
interactive and needs none.

## Not re-audited from zero this phase

A manual screen-reader sweep across the whole product remains the same
disclosed, carried-forward gap noted since Phase 31. No dialog, sheet,
tab, or combobox semantics were touched this phase — both new surfaces
are the simplest possible interactive pattern (a link, or nothing at
all), which is why full verification was feasible within this phase's
scope without a broader sweep.
