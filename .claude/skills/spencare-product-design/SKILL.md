---
description: Apply product-design thinking, UX judgment, visual quality,
  accessibility, and responsive behavior whenever creating, changing,
  reviewing, or fixing any user interface in the Spencare codebase. Use
  for web, mobile web, tablet, and mobile interfaces; UI bugs; component
  changes; design-system work; and frontend implementation.
name: spencare-product-design
---

# Spencare Product Design Skill

## Mission

Build interfaces that help real people understand what Spencare does,
understand their financial situation, and confidently complete tasks
with as little friction as possible.

Do not optimize for screenshots alone. Optimize for comprehension,
usability, trust, accessibility, consistency, and task success.

Claude Code remains the implementation agent. This skill provides a
design and UX decision process; it does not replace the project's
architecture, product requirements, or existing design system.

## When to use this skill

Use this skill whenever work: - creates, updates, refactors, or fixes a
screen, page, route, component, form, navigation, modal, chart, table,
or interaction; - changes layout, spacing, typography, colors, icons,
responsive behavior, loading states, empty states, or error states; -
adds a product feature that changes how users understand or complete a
task; - touches web, mobile web, tablet, or mobile UI; - reviews visual
quality, accessibility, usability, or design consistency.

Use it proactively for UI-impacting work even when the request is
phrased as a technical change. For backend-only changes with no
user-facing impact, do not perform an unnecessary visual redesign.

## Spencare design system (Sera)

Before changing any style, read the existing design tokens in
`apps/web/app/globals.css`. The system uses:

- **Framework:** Tailwind CSS 4 + CSS variables (no hardcoded values)
- **Primitives:** shadcn/ui (Button, Card, Sheet, Dialog, Form, etc.)
- **Custom layer:** `components/spencare/` (NavigationRail, SettingsNav,
  DashboardSection, etc.)
- **Typeface:** Google Sans Flex (loaded via Next.js font)
- **Dark mode:** fully supported via `dark:` Tailwind variants
- **Radius scale:** sm 4px · md 8px · lg 14px · xl 20px · 2xl 28px ·
  3xl 40px
- **Motion:** `--duration-fast` 120ms · `--duration-normal` 200ms ·
  `--duration-slow` 350ms; `--ease-spring` and `--ease-smooth`
- **Financial semantic tokens:** `--color-income`, `--color-expense`,
  `--color-transfer` (and their `-foreground` / `-subtle` variants)
- **Charts:** Apache ECharts 6 — use only when they improve comparison,
  proportion, trend, or decision-making

Always use CSS variables and Tailwind utilities. Never hardcode hex, rgb,
or hsl color values. Never bypass the token system with arbitrary
Tailwind values unless genuinely necessary and documented.

## Non-negotiable principles

1.  **Understand before changing.** Inspect the relevant screen, nearby
    components, routes, product requirements, existing design tokens,
    and current interaction patterns before editing.
2.  **User outcome before decoration.** Identify the user's goal, the
    decision they need to make, and the information or action that
    matters most.
3.  **Make the interface self-explanatory.** Prefer plain language,
    clear labels, visible next steps, meaningful grouping, and familiar
    interaction patterns. Do not make users guess what a metric, icon,
    control, or status means.
4.  **Preserve product truth.** Never invent financial values, business
    rules, data, capabilities, or reassuring claims. Use real
    application logic and available data. Clearly distinguish estimates
    from confirmed values.
5.  **Use the existing system first.** Reuse project components, tokens,
    typography, spacing scales, icon libraries, charting conventions,
    and patterns where appropriate. Improve the system deliberately
    rather than introducing one-off styling.
6.  **Responsive by design.** Treat mobile, mobile web, tablet, and
    desktop as related experiences, not a desktop screen merely shrunk
    to fit. Adapt information priority, navigation, density, layout, and
    interactions to the available space.
7.  **Accessible by default.** Consider keyboard use, visible focus,
    semantic structure, accessible names, contrast, touch target size,
    reduced motion, zoom, and screen-reader comprehension.
8.  **Design for real states.** Consider loading, skeleton, empty,
    first-use, populated, partial-data, error, offline or delayed
    response where relevant, validation, success, disabled, and
    destructive-confirmation states.
9.  **Avoid generic AI-generated UI.** Do not automatically assemble a
    page from repeated cards, gradients, oversized headings, decorative
    charts, arbitrary icons, or unnecessary badges. Choose a layout
    because it supports the user's task.
10. **Critique before declaring done.** Check the result for usability,
    visual hierarchy, responsive behavior, consistency, and regressions.
    Fix meaningful problems rather than merely reporting them.

## Required workflow for every UI change

### 1. Establish context

Before editing: - Read the user's request and preserve its intended
scope. - Inspect the relevant route, component tree, styles, state/data
flow, and neighboring screens. - Read applicable project instructions
such as `CLAUDE.md`, product requirements, design-system docs, and
existing tests. - Identify the current design language and reusable
components. - If a Figma file, screenshot, design reference, or Figma
MCP tools are available and relevant, inspect them. Do not assume access
to Figma or invent design specifications when no reference is
available. - Identify what must remain unchanged, including business
logic, API contracts, permissions, analytics, and existing behavior.

### 2. Frame the UX problem

Briefly determine: - **User and context:** Who is using this, on which
device, and in what situation? - **Primary task:** What must the user
understand or accomplish? - **Critical information:** What should be
noticed first, and what can be secondary? - **Decision or action:** What
should the user be able to decide or do next? - **Friction and risk:**
What could confuse the user, cause an error, or reduce trust? -
**Success criteria:** What observable improvement would make this change
successful?

For a small bug fix, keep this lightweight and proceed. Do not turn
every tiny change into a lengthy discovery exercise.

### 3. Choose the design, don't default to a template

Make deliberate decisions about: - information architecture and content
order; - visual hierarchy, grouping, alignment, whitespace, density,
typography, and color; - controls, interaction affordances, feedback,
and navigation; - data visualization only when it helps answer a real
question; - progressive disclosure where it reduces cognitive load
without hiding essential information; - plain-language microcopy and
meaningful labels; - responsive adaptations and component reuse.

For significant new screens or major redesigns, consider at least two
plausible layout approaches internally, compare their trade-offs against
the user goal, and implement the strongest option. Do not create
multiple variants for a small, clearly specified change unless asked.

### 4. Apply Spencare-specific UX judgment

Spencare helps users understand and manage personal finances.
Therefore: - Explain financial concepts in plain language; do not rely
on finance jargon alone. - Make time periods, units, currency, status,
and calculation context clear. - Distinguish balance, income, spending,
upcoming obligations, savings goals, and safe-to-spend amounts instead
of visually implying they are interchangeable. - Never present a
computed metric without checking its definition, source data, time
range, and edge cases. - Show the most actionable insight first, but do
not use alarmist language or shame users about spending. - Explain why a
financial number matters and what the user can do next when that is
useful. - Use charts only when they improve comparison, trends,
proportions, or decisions. Label axes, periods, legends, and important
values; provide a readable alternative where needed. - Make missing or
incomplete financial data visible. Never disguise missing data as
zero. - Make AI-generated suggestions transparent, appropriately
qualified, and distinguishable from confirmed account facts. - Protect
user trust: avoid manipulative urgency, false certainty, misleading
visual emphasis, and dark patterns.

These principles guide presentation, not financial calculations or
product policy. Follow the authoritative business logic in the codebase
and product specifications.

### 5. Design responsively for the actual target

Inspect the project's existing breakpoints and responsive conventions
before changing them. Test the relevant sizes, including where
applicable: - narrow mobile (around 320--375 CSS px); - common mobile
widths (around 390--430 CSS px); - tablet and compact laptop; - standard
desktop and wide desktop.

These are test suggestions, not mandatory new breakpoints. Use the
project's existing breakpoint system unless there is a demonstrated
reason to change it.

At each relevant size verify: - no unintended horizontal overflow,
clipped content, overlap, or inaccessible controls; - readable
typography and sensible line lengths; - logical reflow and appropriate
information priority; - touch-friendly controls and reachable primary
actions; - navigation, dialogs, tables, charts, and forms remain
usable; - mobile layouts do not simply squeeze desktop columns into
narrow space; - keyboard and focus behavior still make sense.

If the project includes native mobile apps, follow the platform's
established conventions rather than treating every interface as a
responsive web page.

### 6. Implement with engineering discipline

-   Follow the project's existing framework, folder structure, naming,
    state management, and styling conventions.
-   Reuse components and design tokens; avoid duplicate components and
    arbitrary magic values when a system token exists.
-   Keep business logic separate from presentation where the project
    architecture expects it.
-   Preserve real data connections, permissions, validation, loading
    behavior, and error handling.
-   Do not replace working functionality with static mock data or
    decorative controls.
-   Ensure every visible control has a meaningful, working behavior or
    is clearly disabled with an explanation.
-   Avoid broad refactors unrelated to the requested UI change.
-   Do not add dependencies unless there is a clear benefit and the
    change fits project conventions.
-   Do not claim tests, browser checks, or visual verification were
    completed unless they actually were.

### 7. Verify and critique

After implementation, run the most relevant checks available: - project
lint, type checks, targeted tests, and build checks as appropriate; -
existing component or end-to-end tests relevant to the change; - browser
or device preview at relevant responsive sizes when available; -
screenshot/visual comparison with an available reference when useful.

Ask: - Can a first-time user tell what this screen is for? - Is the
primary action obvious without overwhelming secondary actions? - Are
labels and financial concepts understandable? - Is the most important
information visually prominent for a reason? - Are spacing, typography,
color, iconography, and components consistent with the Sera design
system? - Do real data, long labels, large numbers, zero values, missing
values, and error states work? - Does it work with keyboard, touch, zoom,
and assistive technology? - Does it still work on mobile, tablet, and
desktop as applicable? - Did this change unintentionally affect another
screen or existing behavior? - Is any element decorative, repetitive,
misleading, or unnecessary?

Fix issues you find within the requested scope. If a check cannot be
performed, state the limitation honestly and identify the remaining
verification.

## Figma integration

When the Figma MCP server is connected (tools named
`mcp__plugin_figma_figma__*` are available): - call `create_session`
with the target file key before reading designs; - use
`get_design_context` and `get_screenshot` to read reference designs
before implementation; - use `get_variable_defs` and
`search_design_system` to match components and tokens to the live
project; - adapt reference code to the existing application architecture
instead of copying it blindly; - use Figma as a source of design
context, not as a reason to discard project conventions.

When no Figma integration or reference exists, apply the principles in
this skill using the codebase, product context, and available visual
preview.

## Scope and communication

-   For small, well-defined UI fixes, implement directly and keep the
    explanation concise.
-   For larger or ambiguous UX changes, summarize the problem, important
    assumptions, and chosen direction before major implementation when
    practical.
-   Ask a question only when a missing decision materially affects the
    outcome; otherwise make a reasonable, reversible choice and state
    the assumption.
-   Do not redesign unrelated screens or change product behavior merely
    to satisfy aesthetic preference.
-   Keep the user informed of meaningful trade-offs and any checks that
    could not be completed.

## Completion report

When reporting a UI change, briefly state: 1. what changed and which
user problem it addresses; 2. notable responsive, accessibility, or
interaction decisions; 3. checks actually run and their result; 4. any
known limitation or follow-up.

The goal is a coherent, trustworthy, accessible Spencare experience
across the whole product---not just a screen that looks good in
isolation.
