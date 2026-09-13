"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Wallet, CreditCard, TrendingUp } from "lucide-react";
import type { AccountRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccountCard } from "@/components/spencare/account-card";
import { EmptyState } from "@/components/spencare/empty-state";
import { AddAccountSheet } from "./add-account-sheet";
import { EditAccountSheet } from "./edit-account-sheet";
import { ArchiveAccountDialog } from "./archive-account-dialog";

/**
 * Grid-of-cards layout per SP-234 ("Settings > Accounts (Main Grid)"),
 * grouped into type sections with headers — replaces an earlier pass's
 * grouped-<ListRow> layout, which was built before the screen specs were
 * consulted and doesn't match the source screen's actual anatomy
 * (component-inventory.md §6 "Account card" vs §8 "Transaction/list
 * row" are two distinct, non-interchangeable patterns).
 *
 * Column count below 1024px is INFERRED — SP-234 itself marks its own
 * responsive behavior "INFERRED (desktop grid only)"; no mobile/tablet
 * evidence exists for this screen. A single column at narrow widths and
 * two above `sm` is the least-risky reading, not a claimed observation.
 */
const SECTION_ORDER = ["bank", "credit_card", "cash", "investment"] as const;
const SECTION_LABELS: Record<(typeof SECTION_ORDER)[number], string> = {
  bank: "Banks",
  credit_card: "Credit Cards",
  cash: "Cash",
  investment: "Investments",
};
const SECTION_ICONS: Record<(typeof SECTION_ORDER)[number], React.ReactNode> = {
  bank: <Landmark className="size-4" aria-hidden="true" />,
  credit_card: <CreditCard className="size-4" aria-hidden="true" />,
  cash: <Wallet className="size-4" aria-hidden="true" />,
  investment: <TrendingUp className="size-4" aria-hidden="true" />,
};

export function AccountList({
  initialAccounts,
  masked,
}: {
  initialAccounts: AccountRow[];
  masked: boolean;
}) {
  const router = useRouter();
  // Deliberately no local copy of initialAccounts in state: this list
  // always reflects the server's data. Every mutation (add/edit/archive)
  // calls router.refresh() on success, which re-runs the Server Component
  // page and passes fresh `initialAccounts` down -- avoids a stale-local-
  // state bug where a useState(initialAccounts) copy would never resync
  // after the first render (found and fixed during this phase).
  const accounts = initialAccounts;
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [archiving, setArchiving] = useState<AccountRow | null>(null);

  const grouped = SECTION_ORDER.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  })).filter((s) => s.accounts.length > 0);

  function handleMutated() {
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Accounts</h1>
        <Button size="touch" onClick={() => setAddOpen(true)}>
          + Add account
        </Button>
      </div>

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No accounts yet"
              description="Add a bank, credit card, cash wallet, or investment to get started."
            />
          </CardContent>
        </Card>
      ) : null}

      {grouped.map((section) => (
        <div key={section.type} className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
              {SECTION_ICONS[section.type]}
              {SECTION_LABELS[section.type]}
            </h2>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {section.accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                masked={masked}
                onEdit={() => setEditing(account)}
                onDelete={() => setArchiving(account)}
              />
            ))}
          </div>
        </div>
      ))}

      <AddAccountSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          setAddOpen(false);
          handleMutated();
        }}
      />

      {editing ? (
        <EditAccountSheet
          account={editing}
          open={!!editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onSaved={() => {
            setEditing(null);
            handleMutated();
          }}
        />
      ) : null}

      {archiving ? (
        <ArchiveAccountDialog
          account={archiving}
          open={!!archiving}
          onOpenChange={(o) => {
            if (!o) setArchiving(null);
          }}
          onArchived={() => {
            setArchiving(null);
            handleMutated();
          }}
        />
      ) : null}
    </div>
  );
}
