import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Minimal link-based tab row for switching between the two Cash Flow
 * routes built so far (Transactions, Budgets). Not the full Cash Flow
 * hub/tab-bar from SP-081/166 (donut, month pager, Income tab -- step 12,
 * out of scope) -- just enough navigation for two sibling pages under
 * `/cash-flow/*` to reach each other, since no shared layout linked them.
 */
export function CashFlowTabs({ active }: { active: "transactions" | "budgets" }) {
  const tabs = [
    { key: "transactions" as const, label: "Transactions", href: "/cash-flow/transactions" },
    { key: "budgets" as const, label: "Budgets", href: "/cash-flow/budgets" },
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
