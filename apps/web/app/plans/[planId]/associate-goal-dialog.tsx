"use client";

import { useState } from "react";
import type { GoalRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toastConfirmed, toastError } from "@/lib/toast";
import { associatePlanGoalAction } from "../actions";

/**
 * Linking a Goal to a Plan is pure context ("this Goal can help fund this
 * Plan") — it never moves money and never implies an automatic transfer.
 * Only Goals not already linked are offered (the caller filters `goals`).
 */
export function AssociateGoalDialog({
  planId,
  goals,
  open,
  onOpenChange,
  onLinked,
}: {
  planId: string;
  goals: GoalRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const [goalId, setGoalId] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLink() {
    if (!goalId) return;
    setIsSubmitting(true);
    const result = await associatePlanGoalAction(planId, { goalId });
    setIsSubmitting(false);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Goal linked to this Plan.");
    setGoalId(undefined);
    onLinked();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a Goal</DialogTitle>
          <DialogDescription>
            This Goal can help fund this Plan. Linking it is just context — no money moves automatically.
          </DialogDescription>
        </DialogHeader>
        {goals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unlinked Goals available.</p>
        ) : (
          <Select value={goalId} onValueChange={setGoalId}>
            <SelectTrigger aria-label="Choose a Goal">
              <SelectValue placeholder="Choose a Goal" />
            </SelectTrigger>
            <SelectContent>
              {goals.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleLink} disabled={!goalId || isSubmitting}>
            {isSubmitting ? "Linking…" : "Link Goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
