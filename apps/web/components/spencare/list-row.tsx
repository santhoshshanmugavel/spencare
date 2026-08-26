import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * <ListRow> — the one shared row composition for Transaction, Bill, and
 * Budget-category lists (design-system-specification.md §1,
 * component-inventory.md §8). Row height/spacing rhythm is defined once
 * here rather than reimplemented per feature.
 *
 * Anatomy (component-inventory.md §8): leading icon slot -> two-line text
 * stack (title + subtitle) -> zero or more metadata columns -> trailing
 * slot (an amount, typically a <Money>).
 */

export interface ListRowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Middle metadata columns, e.g. category / account text — rendered in row order. */
  metadata?: ReactNode[];
  trailing?: ReactNode;
  /** Hover-revealed actions (desktop) -- component-inventory.md §8's row-hover pattern. */
  hoverActions?: ReactNode;
  onClick?: () => void;
  className?: string;
  /**
   * Only meaningful when `onClick` is set. Without it, a clickable row's
   * accessible name falls back to browser name-from-content — every text
   * node (title, metadata, trailing amount) concatenated with no
   * separators (e.g. "SwiggyDiningHDFC Bank₹450.00"), which is valid but
   * unusable read aloud. Found live during Phase 8 (Transactions), the
   * first feature to actually use ListRow as a clickable row rather than
   * a static line with separate hover-action buttons.
   */
  "aria-label"?: string;
}

export function ListRow({
  icon,
  title,
  subtitle,
  metadata = [],
  trailing,
  hoverActions,
  onClick,
  className,
  "aria-label": ariaLabel,
}: ListRowProps) {
  const isInteractive = typeof onClick === "function";

  const content = (
    <>
      {icon ? <div className="flex size-9 shrink-0 items-center justify-center">{icon}</div> : null}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        {subtitle ? (
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>

      {metadata.map((item, i) => (
        <div key={i} className="hidden shrink-0 text-sm text-muted-foreground sm:block">
          {item}
        </div>
      ))}

      {trailing ? <div className="shrink-0 text-right">{trailing}</div> : null}
    </>
  );

  return (
    <div className={cn("group/row flex min-h-14 items-center gap-3 rounded-lg px-3 py-2", className)}>
      {isInteractive ? (
        // A real <button>, not a div[role=button] wrapping the whole row --
        // when `hoverActions` also contains real buttons (Delete), nesting
        // them inside a div[role=button] is an ARIA "nested interactive
        // controls" violation (axe: nested-interactive), caught live while
        // testing Budgets (Phase 9), the first feature to combine
        // hoverActions with a clickable row. Scoping the button to just the
        // row's own content -- leaving hoverActions as true siblings --
        // keeps every interactive element a sibling, never nested.
        <button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
        </button>
      ) : (
        content
      )}

      {hoverActions ? (
        <div className="hidden shrink-0 items-center gap-1 group-hover/row:flex group-focus-within/row:flex">
          {hoverActions}
        </div>
      ) : null}
    </div>
  );
}
