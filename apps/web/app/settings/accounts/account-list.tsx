"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Wallet, CreditCard, TrendingUp, Pencil, Trash2 } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { AddAccountSheet } from "./add-account-sheet";
import { EditAccountSheet } from "./edit-account-sheet";
import { ArchiveAccountDialog } from "./archive-account-dialog";

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

function trailingFor(account: AccountRow, masked: boolean) {
  if (account.type === "credit_card") {
    const limit = account.credit_limit_minor ?? 0;
    const used = account.credit_used_minor ?? 0;
    const available = DomainMoney.fromMinorUnits(BigInt(limit - used), account.currency as never);
    return (
      <div className="text-right">
        <Money value={available} masked={masked} size="numeric" aria-label={`Credit limit available for ${account.name}`} />
        <p className="text-xs text-muted-foreground">Credit limit available</p>
      </div>
    );
  }
  if (account.type === "investment") {
    const value = DomainMoney.fromMinorUnits(BigInt(account.market_value_minor ?? 0), account.currency as never);
    return (
      <div className="text-right">
        <Money value={value} masked={masked} size="numeric" aria-label={`Total invested in ${account.name}`} />
        <p className="text-xs text-muted-foreground">Total invested</p>
      </div>
    );
  }
  const value = DomainMoney.fromMinorUnits(BigInt(account.balance_minor), account.currency as never);
  return (
    <div className="text-right">
      <Money value={value} masked={masked} size="numeric" tone="auto" aria-label={`Balance for ${account.name}`} />
      <p className="text-xs text-muted-foreground">Total balance</p>
    </div>
  );
}

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
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No accounts yet. Add a bank account, credit card, cash wallet, or investment to get
            started.
          </CardContent>
        </Card>
      ) : null}

      {grouped.map((section) => (
        <Card key={section.type}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {SECTION_ICONS[section.type]}
              {SECTION_LABELS[section.type]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {section.accounts.map((account) => (
              <ListRow
                key={account.id}
                icon={SECTION_ICONS[account.type]}
                title={account.name}
                trailing={trailingFor(account, masked)}
                hoverActions={
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${account.name}`}
                      onClick={() => setEditing(account)}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${account.name}`}
                      onClick={() => setArchiving(account)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                }
              />
            ))}
          </CardContent>
        </Card>
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
