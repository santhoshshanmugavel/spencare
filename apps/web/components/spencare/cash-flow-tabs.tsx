import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Minimal link-based ROUTE switcher between the four top-level Cash Flow
 * pages (Overview, Transactions, Budgets, Bills). This is distinct from
 * the in-page "Recent Transactions / Upcoming Bills" tab switcher SP-081
 * itself describes (a same-page preview toggle inside the new Overview
 * page, built with Radix `Tabs` in `cash-flow-overview.tsx`, not here) --
 * this component only ever does cross-page navigation between sibling
 * routes under `/cash-flow/*`.
 *
 * Phase 13 adds "Overview" (`/cash-flow`, the new landing page) as the
 * first entry; Budgets stays a peer tab here per the locked decision to
 * keep `/cash-flow/budgets` reachable without inventing a redundant
 * "Budgets" entry inside the new page's own in-page switcher.
 */
export function CashFlowTabs({ active }: { active: "overview" | "transactions" | "budgets" | "upcoming" }) {
  const tabs = [
    { key: "overview" as const, label: "Overview", href: "/cash-flow" },
    { key: "transactions" as const, label: "Transactions", href: "/cash-flow/transactions" },
    { key: "budgets" as const, label: "Budgets", href: "/cash-flow/budgets" },
    { key: "upcoming" as const, label: "Upcoming", href: "/cash-flow/upcoming" },
  ];
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "px-3 py-2 text-sm font-medium",
            tab.key === active
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
