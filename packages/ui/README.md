# packages/ui — currently unpopulated (documented scoping decision)

`system-architecture.md §4` designates this package as the home for shared
design-system primitives. During Phase 4A Foundation implementation, all
shadcn/ui primitives and Spencare's composed components (`<Money>`,
`<ListRow>`, `<ConsequentialActionPreview>`, the PIN/OTP composite,
`AppShell`, `NavigationRail`) were built directly inside `apps/web/components`
instead, for a concrete, bounded reason:

- `apps/mcp-server` has no UI and is not a consumer of any visual component.
- `apps/web` is currently the *only* consumer of these components.
- Extracting them into a separate workspace package today would add a
  second Tailwind/PostCSS configuration to keep in sync with zero
  additional benefit, since there is no second consumer to share with yet.

This is a deliberate, documented scoping decision, not a silent deviation
from the architecture — per the project's own principle of not designing
for hypothetical future requirements (see `CLAUDE.md`-equivalent session
guidance). If a second UI-bearing app is ever added to this monorepo, the
components in `apps/web/components/spencare/` are the extraction candidates
for this package at that time, and `apps/web/components/ui/` (the shadcn
primitives) would move here too.

Reported as an implementation-detail deviation in the Phase 4A completion
report, not a conflict with the approved architecture (no document says
these components *must* live in a separate package before a second
consumer exists).
