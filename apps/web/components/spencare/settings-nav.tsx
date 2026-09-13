import type { ReactNode } from "react";
import Link from "next/link";
import { Landmark, Sparkles, User, ShieldCheck, DatabaseBackup, Plug, Mail, EyeOff, Tag, Bell } from "lucide-react";
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
 * "Notifications" is deliberately EXCLUDED: the design source names the
 * nav slot but defines zero screen content for it anywhere in the
 * 194-file review, and no backend behavior exists to link to (Phase 20's
 * own instruction: "ensure no dead-looking production UI is presented as
 * functional"). MCP and Gmail are net-new sections this product's
 * later phases added beyond the original six-item design -- appended
 * after the original order rather than interleaved, so the reused
 * portion of the IA stays recognizable against its source.
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
  { key: "gmail", label: "Gmail", href: "/settings/gmail", icon: <Mail className="size-4" aria-hidden="true" /> },
  { key: "categories", label: "Categories", href: "/settings/categories", icon: <Tag className="size-4" aria-hidden="true" /> },
  { key: "notifications", label: "Notifications", href: "/settings/notifications", icon: <Bell className="size-4" aria-hidden="true" /> },
];

export function SettingsNav({ active }: { active: SettingsNavKey }) {
  return (
    <nav aria-label="Settings" className="w-48 shrink-0">
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

/** The shared two-column Settings layout every Settings page mounts its content inside, in place of that page's own former standalone `<div className="mx-auto max-w-xl ...">` wrapper. */
export function SettingsShell({ active, children }: { active: SettingsNavKey; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-4xl gap-10 py-8">
      <SettingsNav active={active} />
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </div>
  );
}
