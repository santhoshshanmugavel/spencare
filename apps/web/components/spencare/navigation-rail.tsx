"use client";

import type { ReactNode } from "react";
import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isNavItemActive } from "@/lib/navigation";
import { signOutAction } from "@/app/(auth)/actions";

/**
 * <NavigationRail> — the persistent left icon rail, confirmed identical
 * across every reviewed desktop screen (component-inventory.md §18):
 * brand mark, 4 destinations (Spensa/Home, Cash Flow, Goals, Settings),
 * avatar pinned at bottom. Uses shadcn's Tooltip primitive for the
 * hover labels rather than the screen-evidenced quick-reply-chip token,
 * per design-system-specification.md §6's accessibility correction
 * (a tooltip must be non-interactive; a quick-reply chip is not).
 *
 * Phase 28 Part 1: `active` is now derived from the real pathname
 * (`usePathname()` + `isNavItemActive`, see lib/navigation.ts) rather than
 * a boolean each of the 15 call sites used to hardcode by hand -- that
 * self-reported flag could silently drift from the actual route (e.g. it
 * never existed at all on the Spensa chat route). `item.active` is still
 * accepted as an explicit override for a caller with a genuine reason to
 * force a state, but no call site in this app sets it anymore.
 */

export interface NavigationRailItem {
  key: string;
  label: string;
  icon: ReactNode;
  href: string;
  /** Explicit override only -- omit this and let the rail derive it from the current pathname. */
  active?: boolean;
}

export interface NavigationRailUserProfile {
  name?: string | null;
  email: string;
  avatarUrl?: string | null;
}

export interface NavigationRailProps {
  brand: ReactNode;
  items: NavigationRailItem[];
  avatar?: ReactNode;
  /** Renders above the avatar -- the privacy/hide-balances toggle observed in some screens (CF-D03, not yet approved -- see design-decisions.md CF-04). */
  extraFooterSlot?: ReactNode;
  /** When provided, renders a profile avatar at the bottom of the rail with a hover popup showing name, email, and sign-out. */
  userProfile?: NavigationRailUserProfile;
  onNavigate?: (item: NavigationRailItem) => void;
  className?: string;
}

function ProfileButton({ profile }: { profile: NavigationRailUserProfile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const initials = profile.name
    ? profile.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : (profile.email[0] ?? "U").toUpperCase();

  return (
    <div ref={ref} className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Account menu"
            className={cn(
              "flex size-9 items-center justify-center rounded-full text-xs font-semibold transition-colors overflow-hidden",
              profile.avatarUrl
                ? "border-2 border-border hover:border-primary/40"
                : "bg-primary/10 text-primary hover:bg-primary/20",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt={profile.name ?? profile.email} className="size-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              initials
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{profile.name ?? profile.email}</TooltipContent>
      </Tooltip>

      {open ? (
        <div className="absolute bottom-full left-full mb-0 ml-2 z-50 min-w-[200px] rounded-[var(--radius-lg)] border border-border bg-background p-3 shadow-popover">
          <div className="mb-3 space-y-0.5 border-b border-border pb-3">
            {profile.name ? (
              <p className="text-sm font-medium text-foreground leading-tight">{profile.name}</p>
            ) : null}
            <p className="text-xs text-muted-foreground leading-tight truncate">{profile.email}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function NavigationRail({
  brand,
  items,
  avatar,
  extraFooterSlot,
  userProfile,
  onNavigate,
  className,
}: NavigationRailProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex h-full w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-4",
        className,
      )}
    >
      <div className="mb-4">{brand}</div>

      <ul className="flex flex-1 flex-col items-center gap-1">
        {items.map((item) => {
          const active = item.active ?? isNavItemActive(pathname, item.href);
          return (
            <li key={item.key}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={(e) => {
                      if (onNavigate) {
                        e.preventDefault();
                        onNavigate(item);
                      }
                    }}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
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
          );
        })}
      </ul>

      {extraFooterSlot ? <div className="mb-2">{extraFooterSlot}</div> : null}
      {avatar ? <div>{avatar}</div> : null}
      {userProfile ? <div className="mt-1"><ProfileButton profile={userProfile} /></div> : null}
    </nav>
  );
}
