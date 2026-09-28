"use client";

import { useState } from "react";
import type { PlannedCommitmentRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toastConfirmed, toastError } from "@/lib/toast";
import { associatePlanCommitmentAction } from "../actions";

/** Same pure-context linking as AssociateGoalDialog — a Commitment linked to a Plan is descriptive only, never a payment trigger. */
export function AssociateCommitmentDialog({
  planId,
  commitments,
  open,
  onOpenChange,
  onLinked,
}: {
  planId: string;
  commitments: PlannedCommitmentRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const [commitmentId, setCommitmentId] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLink() {
    if (!commitmentId) return;
    setIsSubmitting(true);
    const result = await associatePlanCommitmentAction(planId, { commitmentId });
    setIsSubmitting(false);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Commitment linked to this Plan.");
    setCommitmentId(undefined);
    onLinked();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a Commitment</DialogTitle>
          <DialogDescription>
            Linking is just context for this Plan — it doesn&rsquo;t change how or when the Commitment gets paid.
          </DialogDescription>
        </DialogHeader>
        {commitments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unlinked Commitments available.</p>
        ) : (
          <Select value={commitmentId} onValueChange={setCommitmentId}>
            <SelectTrigger aria-label="Choose a Commitment">
              <SelectValue placeholder="Choose a Commitment" />
            </SelectTrigger>
            <SelectContent>
              {commitments.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleLink} disabled={!commitmentId || isSubmitting}>
            {isSubmitting ? "Linking…" : "Link Commitment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
