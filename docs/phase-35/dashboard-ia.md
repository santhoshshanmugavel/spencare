<title>Phase 35 — Dashboard Information Architecture</title>

# Phase 35 — Dashboard IA

Home's own structure and reasoning are unchanged this phase — see
`docs/phase-34/dashboard-ia.md` for the full, still-current account of
its hierarchy (Safe-to-Spend → Owned Money → Needs your attention → cash
flow trend chart → spending-change/top-category insight → Ask Spensa →
setup checklist) and the reasoned, disclosed decision not to add a
duplicate Upcoming-Commitments card, a Goal Pace strip, or
Investments/Net Worth tiles to Home without direct reference evidence.

## What changed this phase, and why it strengthens Home's IA rather than requiring changes to it

Phase 35's Cash Flow fix (removing the redundant global Safe-to-Spend/
Net Worth card from that page — see `product-decisions.md`) makes
Home's own role in the product's information architecture MORE
consistent, not less: Home is now the product's single, unambiguous
owner of "how much can I safely spend, overall" and "what is my Net
Worth." No other page competes with it for that answer. This is a
direct, positive consequence of this phase's Cash Flow decision on the
whole-product IA the mandate asks about, even though Home's own code
was not touched.

## Per-page "one clear question" check (re-confirmed this phase)

| Page | Question it should answer | Confirmed this phase? |
|---|---|---|
| Home | "How am I doing, overall?" | Yes — live-viewed on a fresh account; Safe-to-Spend/Owned Money/Net Worth/Available Credit all present, correctly labeled, correctly computed. |
| Cash Flow | "Where is my money going?" | Yes — live-viewed with real transaction data; no longer competes with Home for the "how much can I spend" question. |
| Goals | "What am I working toward?" | Carried forward (Phase 33/34); not re-touched. |
| Accounts | "What financial accounts do I have?" | Partially — confirmed live while creating test accounts (Bank/Credit Card tabs, distinct limit/balance fields); not a full re-audit. |
