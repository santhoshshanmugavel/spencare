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
}: ListRowProps) {
  const isInteractive = typeof onClick === "function";

  return (
    <div
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "group/row flex min-h-14 items-center gap-3 rounded-lg px-3 py-2",
        isInteractive &&
          "cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
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

      {hoverActions ? (
        <div className="hidden shrink-0 items-center gap-1 group-hover/row:flex group-focus-within/row:flex">
          {hoverActions}
        </div>
      ) : null}
    </div>
  );
}
