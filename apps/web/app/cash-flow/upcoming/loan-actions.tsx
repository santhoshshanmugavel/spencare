"use client";

import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import type { LoanRow, AccountRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteLoanAction } from "./actions";

export function LoanActions({
  loan,
  accounts,
  onChanged,
  onEdit,
}: {
  loan: LoanRow;
  accounts: AccountRow[];
  onChanged: () => void;
  onEdit: (loan: LoanRow) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${loan.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await deleteLoanAction(loan.id);
    onChanged();
    setDeleting(false);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Loan actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(loan)}>Edit loan</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handleDelete}
          disabled={deleting}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
