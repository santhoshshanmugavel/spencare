"use client";

import { useState } from "react";
import { MoreHorizontal, Pause, Pencil, Play, Trash2 } from "lucide-react";
import type { PlannedCommitmentRow, AccountRow, CategoryRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastConfirmed, toastError } from "@/lib/toast";
import { CommitmentSheet } from "./commitment-sheet";
import { deleteCommitmentAction, pauseCommitmentAction, resumeCommitmentAction } from "./actions";

export function ProjectedItemActions({
  commitment,
  accounts,
  categories,
  onChanged,
}: {
  commitment: PlannedCommitmentRow;
  accounts: AccountRow[];
  categories: CategoryRow[];
  onChanged: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const isPaused = commitment.status === "paused";

  async function handlePauseResume() {
    setLoading(true);
    const result = isPaused
      ? await resumeCommitmentAction(commitment.id)
      : await pauseCommitmentAction(commitment.id);
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed(isPaused ? "Commitment resumed." : "Commitment paused.");
    onChanged();
  }

  async function handleDelete() {
    setLoading(true);
    const result = await deleteCommitmentAction(commitment.id);
    setLoading(false);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed("Commitment deleted.");
    setDeleteOpen(false);
    onChanged();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${commitment.name}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="size-4 mr-2" />
            Edit commitment
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handlePauseResume} disabled={loading}>
            {isPaused ? <Play className="size-4 mr-2" /> : <Pause className="size-4 mr-2" />}
            {isPaused ? "Resume" : "Pause"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 mr-2" />
            Delete commitment
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete commitment</DialogTitle>
            <DialogDescription>
              This will delete {commitment.name} and stop all future payments from being scheduled.
              Past transactions remain. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CommitmentSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => { setEditOpen(false); onChanged(); }}
        accounts={accounts}
        categories={categories}
        existing={commitment}
      />
    </>
  );
}
