"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { calculateGoalProgress } from "@spencare/domain-core";
import type { AccountRow, GoalRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GoalCard } from "@/components/spencare/goal-card";
import { AddGoalSheet } from "./add-goal-sheet";
import { EditGoalSheet } from "./edit-goal-sheet";
import { ContributeSheet } from "./contribute-sheet";
import { WithdrawSheet } from "./withdraw-sheet";
import { ArchiveGoalDialog } from "./archive-goal-dialog";
import { DeleteGoalDialog } from "./delete-goal-dialog";
import { GoalDetailDialog } from "./goal-detail-dialog";

/**
 * SP-181's grid anatomy (top bar + card grid) and SP-183's empty state.
 * Reached/celebratory goals are shown in the SAME grid as active ones
 * (SP-181: "reached/celebratory card variant present in-grid"), not
 * hidden or split into a separate tab -- `listGoals` already excludes
 * only archived/deleted goals by default. The Short-term/Long-term tab
 * toggle (SP-181) is not built -- its own doc note says Long-term content
 * was "not visually confirmed in source," and no data field distinguishes
 * short- vs long-term goals in the schema; a single grid is the honest
 * baseline until that's resolved.
 */
export function GoalsGrid({
  initialGoals,
  accounts,
  fundingEligibleAccounts,
  masked,
}: {
  initialGoals: GoalRow[];
  accounts: AccountRow[];
  fundingEligibleAccounts: AccountRow[];
  masked: boolean;
}) {
  const router = useRouter();
  const goals = initialGoals;
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [contributing, setContributing] = useState<GoalRow | null>(null);
  const [withdrawing, setWithdrawing] = useState<GoalRow | null>(null);
  const [archiving, setArchiving] = useState<GoalRow | null>(null);
  const [deleting, setDeleting] = useState<GoalRow | null>(null);
  const [viewing, setViewing] = useState<GoalRow | null>(null);

  function handleMutated() {
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Goals</h1>
        <Button size="touch" onClick={() => setAddOpen(true)} disabled={fundingEligibleAccounts.length === 0}>
          + Create goal
        </Button>
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No goals yet. Create one to start saving toward something.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {goals.map((goal) => {
            const progress = calculateGoalProgress(goal.target_amount_minor, goal.saved_amount_minor, goal.target_date);
            return (
              <GoalCard
                key={goal.id}
                goal={goal}
                progress={progress}
                fundingAccount={accountById.get(goal.funding_account_id)}
                masked={masked}
                onContribute={() => setContributing(goal)}
                onWithdraw={() => setWithdrawing(goal)}
                onEdit={() => setEditing(goal)}
                onArchive={() => setArchiving(goal)}
                onDelete={() => setDeleting(goal)}
                onViewDetail={() => setViewing(goal)}
              />
            );
          })}
        </div>
      )}

      <AddGoalSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={fundingEligibleAccounts}
        onCreated={() => {
          setAddOpen(false);
          handleMutated();
        }}
      />

      {editing ? (
        <EditGoalSheet
          goal={editing}
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onUpdated={() => {
            setEditing(null);
            handleMutated();
          }}
        />
      ) : null}

      {contributing ? (
        <ContributeSheet
          goal={contributing}
          accounts={fundingEligibleAccounts}
          open={!!contributing}
          onOpenChange={(o) => !o && setContributing(null)}
          onContributed={() => {
            setContributing(null);
            handleMutated();
          }}
        />
      ) : null}

      {withdrawing ? (
        <WithdrawSheet
          goal={withdrawing}
          accounts={fundingEligibleAccounts}
          open={!!withdrawing}
          onOpenChange={(o) => !o && setWithdrawing(null)}
          onWithdrawn={() => {
            setWithdrawing(null);
            handleMutated();
          }}
        />
      ) : null}

      {archiving ? (
        <ArchiveGoalDialog
          goal={archiving}
          open={!!archiving}
          onOpenChange={(o) => !o && setArchiving(null)}
          onArchived={() => {
            setArchiving(null);
            handleMutated();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteGoalDialog
          goal={deleting}
          open={!!deleting}
          onOpenChange={(o) => !o && setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            handleMutated();
          }}
        />
      ) : null}

      {viewing ? (
        <GoalDetailDialog
          goal={viewing}
          fundingAccount={accountById.get(viewing.funding_account_id)}
          masked={masked}
          open={!!viewing}
          onOpenChange={(o) => !o && setViewing(null)}
          onContribute={() => {
            setViewing(null);
            setContributing(viewing);
          }}
          onWithdraw={() => {
            setViewing(null);
            setWithdrawing(viewing);
          }}
          onEdit={() => {
            setViewing(null);
            setEditing(viewing);
          }}
          onArchive={() => {
            setViewing(null);
            setArchiving(viewing);
          }}
          onDelete={() => {
            setViewing(null);
            setDeleting(viewing);
          }}
        />
      ) : null}
    </div>
  );
}
