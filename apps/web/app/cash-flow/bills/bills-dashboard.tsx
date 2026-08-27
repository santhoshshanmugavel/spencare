"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type {
  AccountRow,
  BillDefinitionRow,
  BillPredictionWithDefinition,
  CategoryRow,
} from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { AddBillSheet } from "./add-bill-sheet";
import { EditBillSheet } from "./edit-bill-sheet";
import { DeleteBillDialog } from "./delete-bill-dialog";
import { BillNowSheet } from "./bill-now-sheet";
import { BillStatusBadge } from "./bill-status-badge";
import { getBillAction, undoPaidAction } from "./actions";
import { toastConfirmed, toastError } from "@/lib/toast";

/**
 * SP-231 (no-budget state) / SP-232 (budget-configured state) / SP-084
 * (genuine empty state) / SP-091 (populated list) -- all Cash Flow
 * Overview tab-states, not standalone Bills screens (the surrounding
 * donut/account-selector/right-panel chrome is step-12 Cash Flow
 * Overview, out of this phase's scope per the locked Phase 12 UI-scope
 * decision). This renders the Bills LIST slice only, the same "slice of
 * a bigger screen" precedent as BudgetDashboard/TransactionList.
 *
 * `<ListRow>` (not a new `BillCard`) is the correct primitive --
 * component-inventory.md §8 directly cites SP-231/232 for it, including
 * the "Bill Now" hover-CTA. "Bill Now" (and "Undo" on a settled row) are
 * rendered as PERSISTENT trailing buttons, not inside `hoverActions` --
 * SP-091 itself flags hover-only "Bill Now" as a gap with no documented
 * touch equivalent, the same lesson GoalCard already learned for
 * "Add Cash." Edit/Delete stay in `hoverActions` (secondary, desktop-
 * convenience actions, same as Budgets' own row).
 */

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  yearly: "Yearly",
  irregular: "Irregular",
};

const CURRENCY = "INR";

function formatDueDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function isUpcoming(p: BillPredictionWithDefinition): boolean {
  return p.status === "open" || p.status === "overdue";
}

export function BillsDashboard({
  initialPredictions,
  accounts,
  categories,
  masked,
}: {
  initialPredictions: BillPredictionWithDefinition[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  masked: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [payingPrediction, setPayingPrediction] = useState<BillPredictionWithDefinition | null>(null);
  const [editingBill, setEditingBill] = useState<BillDefinitionRow | null>(null);
  const [deletingBill, setDeletingBill] = useState<BillDefinitionRow | null>(null);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const predictions = initialPredictions;
  const upcoming = predictions.filter(isUpcoming).sort((a, b) => (a.expected_date < b.expected_date ? -1 : 1));
  const settled = predictions.filter((p) => !isUpcoming(p)).sort((a, b) => (a.expected_date < b.expected_date ? 1 : -1));

  function handleMutated() {
    router.refresh();
  }

  async function openEdit(billDefinitionId: string) {
    const bill = await getBillAction(billDefinitionId);
    if (!bill) {
      toastError("That bill no longer exists.");
      return;
    }
    setEditingBill(bill);
  }

  async function openDelete(billDefinitionId: string) {
    const bill = await getBillAction(billDefinitionId);
    if (!bill) {
      toastError("That bill no longer exists.");
      return;
    }
    setDeletingBill(bill);
  }

  async function handleUndo(predictionId: string, merchantName: string) {
    const result = await undoPaidAction(predictionId);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(`${merchantName} payment undone -- bill is open again.`);
    handleMutated();
  }

  function renderRow(p: BillPredictionWithDefinition) {
    const category = p.bill_definitions.category_id ? categoryById.get(p.bill_definitions.category_id) : undefined;
    // A matched row shows the REAL settled amount (Invariant #9: a
    // prediction must stay visually distinct from a real transaction) --
    // the user may have entered a different real amount at Bill Now time
    // than the prediction's own stale expected_amount_minor guess.
    const amountMinor = p.status === "matched" ? (p.matched_transaction?.amount_minor ?? p.expected_amount_minor) : p.expected_amount_minor;
    return (
      // REAL DEFECT FOUND LIVE (Phase 12's own responsive verification,
      // fixed before this ever shipped): the persistent Bill Now/Undo
      // button was originally packed into ListRow's own `trailing` slot
      // alongside the amount+badge. `trailing` is `shrink-0` by design (so
      // a Money figure never truncates) -- cramming a whole button in
      // there too made the combined trailing content wide enough, at a
      // 375px mobile viewport, to squeeze the title/subtitle's `flex-1`
      // slot down to zero visible width (present in the DOM, invisible on
      // screen). Moving the persistent action to its own row below keeps
      // `trailing` narrow (just amount + badge) so the title never loses
      // its space, at any width.
      <div key={p.id} className="space-y-1">
        <ListRow
          icon={<CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />}
          title={p.bill_definitions.merchant_pattern}
          subtitle={`${RECURRENCE_LABELS[p.bill_definitions.recurrence_interval] ?? p.bill_definitions.recurrence_interval} · Due ${formatDueDate(p.expected_date)}`}
          metadata={[category ? <span key="cat">{category.name}</span> : null].filter(Boolean)}
          trailing={
            <div className="flex flex-col items-end gap-1">
              {amountMinor != null ? (
                <Money value={DomainMoney.fromMinorUnits(BigInt(amountMinor), CURRENCY as never)} masked={masked} size="numeric" tone="neutral" />
              ) : (
                <span className="text-sm text-muted-foreground">Amount varies</span>
              )}
              <BillStatusBadge status={p.status} expectedDate={p.expected_date} />
            </div>
          }
          hoverActions={
            <>
              <Button variant="ghost" size="sm" onClick={() => openEdit(p.bill_definition_id)}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => openDelete(p.bill_definition_id)}>
                Delete
              </Button>
            </>
          }
        />
        <div className="flex justify-end px-3">
          {isUpcoming(p) ? (
            <Button size="sm" variant="outline" onClick={() => setPayingPrediction(p)}>
              Bill Now
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => handleUndo(p.id, p.bill_definitions.merchant_pattern)}>
              Undo
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Bills</h1>
        <Button size="touch" onClick={() => setAddOpen(true)}>
          + Add bill
        </Button>
      </div>

      {predictions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No bills yet. Add a recurring bill so Spencare can predict when it&rsquo;s due and remind you to pay it.
          </CardContent>
        </Card>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <div className="space-y-1">
              <h2 className="px-1 text-sm font-medium text-muted-foreground">Upcoming</h2>
              <Card>
                <CardContent className="space-y-1">{upcoming.map(renderRow)}</CardContent>
              </Card>
            </div>
          ) : null}

          {settled.length > 0 ? (
            <div className="space-y-1">
              <h2 className="px-1 text-sm font-medium text-muted-foreground">Paid</h2>
              <Card>
                <CardContent className="space-y-1">{settled.map(renderRow)}</CardContent>
              </Card>
            </div>
          ) : null}
        </>
      )}

      <AddBillSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        categories={categories}
        onCreated={() => {
          setAddOpen(false);
          handleMutated();
        }}
      />

      {payingPrediction ? (
        <BillNowSheet
          prediction={payingPrediction}
          accounts={accounts}
          categories={categories}
          open={!!payingPrediction}
          onOpenChange={(o) => {
            if (!o) setPayingPrediction(null);
          }}
          onPaid={() => {
            setPayingPrediction(null);
            handleMutated();
          }}
        />
      ) : null}

      {editingBill ? (
        <EditBillSheet
          bill={editingBill}
          categories={categories}
          open={!!editingBill}
          onOpenChange={(o) => {
            if (!o) setEditingBill(null);
          }}
          onUpdated={() => {
            setEditingBill(null);
            handleMutated();
          }}
        />
      ) : null}

      {deletingBill ? (
        <DeleteBillDialog
          bill={deletingBill}
          open={!!deletingBill}
          onOpenChange={(o) => {
            if (!o) setDeletingBill(null);
          }}
          onDeleted={() => {
            setDeletingBill(null);
            handleMutated();
          }}
        />
      ) : null}
    </div>
  );
}
