"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isNavItemActive } from "@/lib/navigation";
import type { NavigationRailItem } from "./navigation-rail";

/**
 * Mobile bottom navigation. Renders the SAME primary destinations as
 * NavigationRail so a user's mental model carries across viewports;
 * fixed to the bottom of the viewport, safe-area aware, and composed
 * of touch-sized tap targets (min 44px). Below the `md:` breakpoint
 * the left rail is hidden and this bar takes over; from `md:` and up
 * the bar hides and the rail returns. The two never render at the
 * same time, so no duplicate navigation controls exist on any screen
 * width.
 *
 * Deliberately NOT reactive to item.active -- same convention as the
 * rail: the current pathname drives the active state so no page has
 * to hardcode it or risk the badge drifting from the actual route.
 */
export function BottomNavBar({
  items,
  className,
}: {
  items: NavigationRailItem[];
  className?: string;
}) {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background md:hidden",
        // Honor the iPhone home-indicator / Android gesture area so the
        // bottom row of icons never sits under the system handle.
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      <ul className="mx-auto flex max-w-screen-sm items-stretch justify-around">
        {items.map((item) => {
          const active = item.active ?? isNavItemActive(pathname, item.href);
          return (
            <li key={item.key} className="flex-1">
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                // 44px minimum tap area (height is enforced by py + icon size;
                // the min-h-11 fallback keeps the row above the 44px floor
                // even when the icon is unusually small).
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span aria-hidden="true" className="flex items-center justify-center">
                  {item.icon}
                </span>
                <span className="truncate text-[11px] leading-tight">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
