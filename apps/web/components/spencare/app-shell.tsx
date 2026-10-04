import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BottomNavBar } from "./bottom-nav-bar";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";

/**
 * <AppShell> -- the global page composition every feature screen
 * mounts inside. Behaves responsively:
 *
 *   mobile  (< md)  ->  bottom navigation bar (BottomNavBar) + full-
 *                       width main. The left rail is hidden; it would
 *                       otherwise steal 56-80px of horizontal space on
 *                       a 360px phone.
 *   tablet+ (>= md) ->  original persistent left NavigationRail +
 *                       main + optional right-docked panel.
 *
 * Main padding scales from a tight 16px on phones (where every pixel
 * of content width matters) up to 24-32px on larger screens. Bottom
 * padding on mobile reserves room for the BottomNavBar PLUS the home-
 * indicator safe-area inset so the last row of a long list never gets
 * covered by the nav bar.
 *
 * The right-docked `panel` is desktop-only (`md:block`) because at
 * phone widths a 400px panel would consume the entire viewport; panel-
 * style surfaces (transaction detail, Spensa) switch to a bottom sheet
 * on mobile in their own components rather than being squeezed into
 * this shell layout.
 */
export interface AppShellProps {
  rail: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  /** The right-docked slide-over panel content, when open (transaction detail, budget edit, Spensa chat, etc). Rendered only at `md:` and up. */
  panel?: ReactNode;
  className?: string;
}

export function AppShell({ rail, header, children, panel, className }: AppShellProps) {
  return (
    <div className={cn("flex h-dvh w-full overflow-hidden bg-background", className)}>
      {/* Left rail: only on tablet+ widths. On phones the BottomNavBar below takes over. */}
      <div className="hidden md:block">{rail}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        {header ? (
          <header className="shrink-0 border-b border-border px-4 py-3 sm:px-6 sm:py-4">{header}</header>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <main
            className={cn(
              "min-w-0 flex-1 overflow-y-auto",
              // Mobile padding is intentionally tight so a 360px viewport
              // keeps as much content width as possible. Larger breakpoints
              // relax it.
              "px-4 py-4 sm:px-6 sm:py-5 md:px-8 md:py-6",
              // Reserve clearance under the bottom nav + home-indicator
              // safe-area on mobile. The rail-based desktop layout needs
              // no extra bottom padding (no fixed footer).
              "pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6",
            )}
          >
            {children}
          </main>
          {panel ? (
            <aside className="hidden w-[400px] shrink-0 overflow-y-auto border-l border-border md:block">
              {panel}
            </aside>
          ) : null}
        </div>
      </div>
      {/* Mobile-only bottom navigation; hidden at `md:` and up where the left rail returns. */}
      <BottomNavBar items={PRIMARY_NAV_ITEMS} />
    </div>
  );
}
