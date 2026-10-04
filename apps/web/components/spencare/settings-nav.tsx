import type { ReactNode } from "react";
import Link from "next/link";
import { Landmark, Sparkles, User, ShieldCheck, DatabaseBackup, Plug, EyeOff, Tag, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * <SettingsNav> / <SettingsShell> -- Phase 20's minimum shared Settings
 * navigation (design-decisions.md's six-item Settings IA, evidenced by
 * screens SP-311-321 and the "While Disconnect" reference: Accounts /
 * Spensa's Brain / Profile / Notifications / Security / Data & Backup,
 * shown as a persistent left sub-nav within the Settings area).
 *
 * Deliberately NOT a full navigation redesign (Phase 20's own scope
 * limit): this is the smallest addition that makes every existing
 * Settings route discoverable from within the app, reusing the exact
 * active/inactive treatment already established elsewhere (the
 * `bg-primary/10 text-primary` soft-highlight pattern used for "Active"
 * states in `<AiProviderManager>`/`<McpSessionManager>`/
 * `<GmailConnectionManager>`, not `<NavigationRail>`'s solid-pill
 * treatment, since these are row-shaped items, not circular icon
 * buttons).
 *
 * Responsive behavior (added Phase 2 of the mobile-first work):
 *
 *   mobile  (< md)  ->  a horizontal scrollable chip row at the top of
 *                       each settings page. Each chip is a touch-sized
 *                       button carrying an icon + label; the active one
 *                       picks up the same `bg-primary/10 text-primary`
 *                       pill treatment the desktop column uses, so the
 *                       visual language is consistent across viewports.
 *                       The row horizontally overflows and scrolls
 *                       within itself (never the page) so every section
 *                       stays reachable at 360px without a dropdown.
 *   desktop (>= md) ->  the original persistent left `w-48` column, no
 *                       behavior change.
 *
 * The two layouts are rendered via a single component tree with Tailwind
 * responsive classes so no page needs to pick between them; the correct
 * presentation emerges from the viewport width.
 *
 * "Notifications" is deliberately EXCLUDED from the original source but
 * reinstated here for completeness; MCP and Gmail are net-new sections
 * this product's later phases added beyond the original six-item design
 * -- appended after the original order rather than interleaved, so the
 * reused portion of the IA stays recognizable against its source.
 */

export type SettingsNavKey = "accounts" | "ai" | "profile" | "privacy" | "security" | "data-backup" | "mcp" | "gmail" | "categories" | "notifications";

interface SettingsNavItem {
  key: SettingsNavKey;
  label: string;
  href: string;
  icon: ReactNode;
}

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { key: "accounts", label: "Accounts", href: "/settings/accounts", icon: <Landmark className="size-4" aria-hidden="true" /> },
  { key: "ai", label: "Spensa's Brain", href: "/settings/ai", icon: <Sparkles className="size-4" aria-hidden="true" /> },
  { key: "profile", label: "Profile", href: "/settings/profile", icon: <User className="size-4" aria-hidden="true" /> },
  { key: "privacy", label: "Privacy", href: "/settings/privacy", icon: <EyeOff className="size-4" aria-hidden="true" /> },
  { key: "security", label: "Security", href: "/settings/security", icon: <ShieldCheck className="size-4" aria-hidden="true" /> },
  { key: "data-backup", label: "Data & Backup", href: "/settings/data-backup", icon: <DatabaseBackup className="size-4" aria-hidden="true" /> },
  { key: "mcp", label: "MCP", href: "/settings/mcp", icon: <Plug className="size-4" aria-hidden="true" /> },
  // Gmail nav entry hidden (feature temporarily not exposed in UI; backend intact)
  { key: "categories", label: "Categories", href: "/settings/categories", icon: <Tag className="size-4" aria-hidden="true" /> },
  { key: "notifications", label: "Notifications", href: "/settings/notifications", icon: <Bell className="size-4" aria-hidden="true" /> },
];

/**
 * Desktop left column. Hidden below `md:` -- the mobile layout uses
 * MobileSettingsNavChips below (horizontal chip strip above the page
 * content) rather than a sidebar competing with the content column for
 * horizontal space on phones.
 */
export function SettingsNav({ active }: { active: SettingsNavKey }) {
  return (
    <nav aria-label="Settings" className="hidden w-48 shrink-0 md:block">
      {/* Not an <h1> -- each Settings page renders its own single page heading (e.g. "Profile", "Data & Backup") in the content column; this is a section label, not a competing page title. */}
      <p className="mb-4 px-3 text-lg font-semibold text-foreground">Settings</p>
      <ul className="space-y-1">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Mobile-only horizontal chip strip. Shown above the settings page
 * content below `md:`. The strip scrolls horizontally within itself;
 * page-level overflow stays contained, and every section remains
 * reachable at 360px without introducing a dropdown or a separate
 * settings-index route.
 */
function MobileSettingsNavChips({ active }: { active: SettingsNavKey }) {
  return (
    <nav
      aria-label="Settings"
      className="-mx-4 mb-4 overflow-x-auto md:hidden"
    >
      <ul className="flex min-w-full gap-2 px-4">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  // 44px touch target via min-h-11 + py-2 so a thumb can
                  // tap chips without hitting a neighboring one.
                  "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The shared Settings layout every settings page mounts its content
 * inside. Responsive:
 *
 *   mobile  -> stacks: chip-strip nav on top, then full-width content.
 *   desktop -> two columns: left SettingsNav + right content, max-w-4xl.
 *
 * Padding scales so phones get a comfortable 16px gutter instead of
 * the desktop 40px gap.
 */
export function SettingsShell({ active, children }: { active: SettingsNavKey; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 py-4 md:flex-row md:gap-10 md:py-8">
      <MobileSettingsNavChips active={active} />
      <SettingsNav active={active} />
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </div>
  );
}
