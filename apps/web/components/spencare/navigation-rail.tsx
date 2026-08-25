"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * <NavigationRail> — the persistent left icon rail, confirmed identical
 * across every reviewed desktop screen (component-inventory.md §18):
 * brand mark, 4 destinations (Spensa/Home, Cash Flow, Goals, Settings),
 * avatar pinned at bottom. Uses shadcn's Tooltip primitive for the
 * hover labels rather than the screen-evidenced quick-reply-chip token,
 * per design-system-specification.md §6's accessibility correction
 * (a tooltip must be non-interactive; a quick-reply chip is not).
 */

export interface NavigationRailItem {
  key: string;
  label: string;
  icon: ReactNode;
  href: string;
  active?: boolean;
}

export interface NavigationRailProps {
  brand: ReactNode;
  items: NavigationRailItem[];
  avatar?: ReactNode;
  /** Renders above the avatar -- the privacy/hide-balances toggle observed in some screens (CF-D03, not yet approved -- see design-decisions.md CF-04). */
  extraFooterSlot?: ReactNode;
  onNavigate?: (item: NavigationRailItem) => void;
  className?: string;
}

export function NavigationRail({
  brand,
  items,
  avatar,
  extraFooterSlot,
  onNavigate,
  className,
}: NavigationRailProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex h-full w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-4",
        className,
      )}
    >
      <div className="mb-4">{brand}</div>

      <ul className="flex flex-1 flex-col items-center gap-1">
        {items.map((item) => (
          <li key={item.key}>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  onClick={(e) => {
                    if (onNavigate) {
                      e.preventDefault();
                      onNavigate(item);
                    }
                  }}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-full transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    item.active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span className="sr-only">{item.label}</span>
                </a>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>

      {extraFooterSlot ? <div className="mb-2">{extraFooterSlot}</div> : null}
      {avatar ? <div>{avatar}</div> : null}
    </nav>
  );
}
