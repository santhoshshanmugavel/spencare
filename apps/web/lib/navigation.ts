/**
 * Phase 28 Part 1: pathname-derived navigation active-state.
 *
 * Replaces 15 separate page files each manually hardcoding a boolean
 * `active: true` on exactly one of its own `NavigationRail` items (the
 * anti-pattern the Phase 28 mandate calls out by name) with one pure,
 * testable function the rail component itself calls via `usePathname()`.
 *
 * MATCHING RULE: compares the FIRST path segment only, not the full
 * pathname and not a string-prefix check on `href`. Two reasons a full-
 * path or prefix match would be wrong here:
 *
 * 1. Nested routes: `/cash-flow/transactions`, `/cash-flow/budgets`, etc.
 *    must all activate the "Cash Flow" rail item, whose own `href` is the
 *    section root `/cash-flow` -- first-segment comparison handles this
 *    for free.
 * 2. The Settings rail item's `href` is `/settings/profile` (a specific
 *    default landing page, not the bare `/settings` section root) on
 *    every page that renders it -- a full-pathname or href-as-prefix
 *    match would make `/settings/accounts` fail to activate it (its
 *    pathname is not `/settings/profile` and does not start with
 *    `/settings/profile/`). First-segment comparison correctly treats
 *    both as the same "settings" section.
 *
 * This also correctly produces "no rail item active" on
 * `/spensa/[conversationId]` -- its own rail items are Home/Cash
 * Flow/Goals/Settings (there is no fifth "Spensa" rail icon anywhere in
 * this app), and "spensa" matches none of their first segments. That is
 * the correct rendering, not a gap this function needs to work around.
 *
 * A trailing slash, a query string, or a hash fragment on either side
 * never changes the result -- both are normalized identically before
 * segmenting. A dynamic segment (e.g. `/goals/[goalId]`) is handled the
 * same way as any other segment -- only the first segment is ever
 * inspected, so depth beyond that never matters.
 */
export function isNavItemActive(pathname: string | null | undefined, href: string): boolean {
  return firstSegment(pathname) === firstSegment(href);
}

function firstSegment(path: string | null | undefined): string {
  if (!path) return "";
  const withoutQuery = path.split("?", 1)[0]!.split("#", 1)[0]!;
  const segment = withoutQuery.split("/").find((part) => part.length > 0);
  return segment ?? "";
}
