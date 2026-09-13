import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ListRowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Middle metadata columns, e.g. category / account text — rendered in row order. */
  metadata?: ReactNode[];
  trailing?: ReactNode;
  /** Hover-revealed actions (desktop). */
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
      {icon ? <div className="shrink-0">{icon}</div> : null}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground leading-snug">{title}</div>
        {subtitle ? (
          <div className="truncate text-xs text-muted-foreground mt-0.5">{subtitle}</div>
        ) : null}
      </div>

      {metadata.map((item, i) => (
        <div key={i} className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {item}
        </div>
      ))}

      {trailing ? <div className="shrink-0 text-right">{trailing}</div> : null}
    </>
  );

  return (
    <div className={cn("group/row flex min-h-[3.25rem] items-center gap-3 rounded-xl px-3 py-2 transition-colors", className)}>
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
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 -mx-3 -my-2 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
