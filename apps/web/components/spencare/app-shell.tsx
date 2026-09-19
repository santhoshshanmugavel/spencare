import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * <AppShell> — the global page composition every feature screen mounts
 * inside (design-system.md §1): NavigationRail | header + content | an
 * optional right-docked Sheet-based detail panel (see
 * component-inventory.md §12 -- the dominant "detail/edit/chat" pattern
 * across the whole product, not a page-navigation).
 */

export interface AppShellProps {
  rail: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  /** The right-docked slide-over panel content, when open (transaction detail, budget edit, Spensa chat, etc). */
  panel?: ReactNode;
  className?: string;
}

export function AppShell({ rail, header, children, panel, className }: AppShellProps) {
  return (
    <div className={cn("flex h-dvh w-full overflow-hidden bg-background", className)}>
      {rail}
      <div className="flex min-w-0 flex-1 flex-col">
        {header ? (
          <header className="shrink-0 border-b border-border px-6 py-4">{header}</header>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto px-8 py-6">{children}</main>
          {panel ? (
            <aside className="hidden w-[400px] shrink-0 overflow-y-auto border-l border-border md:block">
              {panel}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
