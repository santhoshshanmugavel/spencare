<title>Phase 37 — Product Decision Log</title>

# Phase 37 — Product Decision Log

## Decision 1: Home stays the financial dashboard; Spensa stays a dedicated surface (LOCKED)

**PROBLEM**: Re-reading `Home screen.pdf` and its `-1` through `-5`
variants directly this phase (not relying on any prior phase's
description of them) revealed they all depict a Spensa-conversational
landing page — "I'm Spensa, your intelligent money partner," a large
ask-input, five starter chips, and a "Complete your setup" checklist —
not a financial dashboard. This directly named file conflicts with 35
phases of work building `/home` as a traditional dashboard (Safe-to-
Spend hero, Owned Money, Needs your attention, trend chart) with Spensa
as a separate `/spensa` surface reached via a nav-rail icon.

**USER IMPACT OF GETTING THIS WRONG**: Either outcome — keeping a
"wrong" dashboard Home, or launching an enormous unrequested rebuild
into a chat-first landing page — that turns out to be the wrong call
has serious cost: the first risks shipping a product that misses a
foundational reference intent; the second risks discarding significant,
tested, working product surface based on one ambiguous piece of
evidence (a file name that may simply reflect the original designer's
own folder organization, not a literal IA requirement).

**OPTIONS PRESENTED TO THE USER**: (1) keep the dashboard as Home,
treating the reference files as depicting the existing `/spensa`
surface; (2) make Spensa chat the literal default landing route; (3)
build both side-by-side for comparison; (4) let the user supply
additional context.

**DECISION**: Option 1, made explicitly by the user in this phase's own
mandate: "HOME = primary financial dashboard, SPENSA = dedicated AI
financial-brain/chat surface. Do NOT revisit or reopen this routing
decision unless new concrete reference evidence directly contradicts
it."

**WHY**: This is a product-identity decision with no clean way to infer
the "correct" answer from the reference material alone — exactly the
kind of decision this engagement's own established discipline (Section
38's STOP CONDITIONS, invoked in earlier phases) reserves for the
product owner rather than resolving unilaterally from a single
ambiguous signal.

**RATIONALE RECORDED FOR THE ALTERNATIVE READING**: The `Home screen.pdf`
naming is best explained as the reference designer's own file-naming
convention for what became this product's Spensa surface — plausible
given the current app already has a real, separate, working route
(`/spensa/[conversationId]`) whose actual content (ask-input, chat
thread, starter prompts) matches these files closely once its own
missing chips are added (see Decision 2 below).

**TRADEOFF**: None chosen against — this is a locked decision, not
being re-litigated.

**VERIFICATION**: N/A — a routing decision, not a testable behavior.
Recorded here so no future phase re-opens it without the user's own
"new concrete reference evidence" bar being met.

## Decision 2: Add the reference's starter-prompt chips to Spensa's empty state

See `reference-audit.md` Finding 1 for the full REFERENCE/CURRENT/
DIFFERENCE/DECISION record. Summary: implemented verbatim, using the
existing message-send path (no new, separate, potentially-unsafe code
path), live-verified including its honest failure mode when no AI
provider is configured.

## Decision 3: Do not build the in-conversation quick-reply pattern this phase

**PROBLEM**: `Chat Exp.pdf`/`Spensa Reply with Quick reply buttons.pdf`
show Spensa's own mid-conversation responses sometimes including
reply-shaped quick actions (e.g., "View recent dinings" / "Modify" /
"Delete" buttons attached to a specific answer).

**DECISION**: Not built this phase.

**WHY**: This is fundamentally different from the empty-state starter
chips (Decision 2) — it requires the model's own tool-calling/response
shape to carry structured suggested actions, which is a real feature-
design and prompt/tool-schema task touching `packages/ai`, not a UI
copy-paste. Building a shortcut version (e.g., regex-matching Spensa's
text output to guess at buttons) would risk exactly the "fake AI"
anti-pattern this engagement has repeatedly refused to introduce.

**TRADEOFF**: The empty-state chips alone don't fully close the
reference gap for Spensa's conversational richness. Recorded as a real,
disclosed, deferred gap (P2) rather than silently dropped or faked.
