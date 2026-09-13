"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { calculateGoalProgress } from "@spencare/domain-core";
import type { AccountRow, GoalRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/spencare/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GoalCard } from "@/components/spencare/goal-card";
import { GoalWizardSheet } from "@/components/spencare/goal-wizard-sheet";
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
 * only archived/deleted goals by default.
 *
 * Reference fidelity pass (Goals-9.pdf / Goals-6.pdf): the Short term /
 * Long term segmented control is a REAL filter, not cosmetic -- it's now
 * backed by `goals.term` (migration 20260910000001) and narrows the grid
 * exactly like the account-type filter narrows Accounts. Search filters by
 * goal name across whichever term tab is active, same "narrows the
 * already-filtered set" composition as Cash Flow's own account+category
 * filters.
 */
type GoalTermFilter = "short" | "long";
export function GoalsGrid({
  initialGoals,
  accounts,
  fundingEligibleAccounts,
  contributionEligibleAccounts,
  masked,
  imageSignedUrls,
}: {
  initialGoals: GoalRow[];
  accounts: AccountRow[];
  /** Bank/Cash/Investment -- Phase 28: eligible to be SET as a goal's funding account (pure metadata, never moves money). Used by Add/Edit only. */
  fundingEligibleAccounts: AccountRow[];
  /** Bank/Cash only -- eligible as the FROM account for a real +Add Cash contribution or withdrawal (calls the balance-mutating RPC). Investment is deliberately excluded here even though it IS funding-eligible above -- no "sell investment to fund a goal" operation exists in this codebase. Used by Contribute/Withdraw only. */
  contributionEligibleAccounts: AccountRow[];
  masked: boolean;
  /** goalId -> signed URL, resolved server-side by the page (see `resolveGoalImageUrls`); absent entries render the no-image fallback. */
  imageSignedUrls: Record<string, string>;
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
  const [termFilter, setTermFilter] = useState<GoalTermFilter>("short");
  const [search, setSearch] = useState("");

  function handleMutated() {
    router.refresh();
  }

  const query = search.trim().toLowerCase();
  const shortTermGoals = useMemo(
    () => goals.filter((g) => g.term === "short" && (query === "" || g.name.toLowerCase().includes(query))),
    [goals, query],
  );
  const longTermGoals = useMemo(
    () => goals.filter((g) => g.term === "long" && (query === "" || g.name.toLowerCase().includes(query))),
    [goals, query],
  );

  function renderSection(list: GoalRow[], termLabel: "short term" | "long term") {
    if (goals.length === 0) {
      return (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No goals yet"
              description="Create a goal to start saving toward something meaningful."
            />
          </CardContent>
        </Card>
      );
    }
    if (list.length === 0) {
      return (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title={search ? `No matches for "${search}"` : `No ${termLabel} goals`}
              description={search ? "Try a different search term." : `Add a ${termLabel} goal to see it here.`}
              action={!search ? { label: "+ Create goal", onClick: () => setAddOpen(true) } : undefined}
            />
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.map((goal) => {
          const progress = calculateGoalProgress(goal.target_amount_minor, goal.saved_amount_minor, goal.target_date);
          return (
            <GoalCard
              key={goal.id}
              goal={goal}
              progress={progress}
              fundingAccount={accountById.get(goal.funding_account_id)}
              masked={masked}
              imageSignedUrl={imageSignedUrls[goal.id] ?? null}
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
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={termFilter} onValueChange={(v) => setTermFilter(v as GoalTermFilter)} className="gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">Goals</h1>
          <TabsList>
            <TabsTrigger value="short">Short term</TabsTrigger>
            <TabsTrigger value="long">Long term</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                placeholder="Search goals"
                aria-label="Search goals"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-44 pl-9"
              />
            </div>
            <Button size="touch" onClick={() => setAddOpen(true)}>
              + Create goal
            </Button>
          </div>
        </div>

        <TabsContent value="short">{renderSection(shortTermGoals, "short term")}</TabsContent>
        <TabsContent value="long">{renderSection(longTermGoals, "long term")}</TabsContent>
      </Tabs>

      <GoalWizardSheet
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
          accounts={fundingEligibleAccounts}
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
          accounts={contributionEligibleAccounts}
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
          accounts={contributionEligibleAccounts}
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
          imageSignedUrl={imageSignedUrls[viewing.id] ?? null}
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
