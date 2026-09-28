"use client";

import { useState } from "react";
import type { AccountRow } from "@spencare/domain-application";
import { ACCOUNT_TYPE_LABELS } from "@spencare/domain-core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toastConfirmed, toastError } from "@/lib/toast";
import { associatePlanAccountAction } from "../actions";

/** Same pure-context linking — an Account linked to a Plan is descriptive ("spend for this trip mostly comes from here"), never a source-of-funds enforcement. */
export function AssociateAccountDialog({
  planId,
  accounts,
  open,
  onOpenChange,
  onLinked,
}: {
  planId: string;
  accounts: AccountRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const [accountId, setAccountId] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLink() {
    if (!accountId) return;
    setIsSubmitting(true);
    const result = await associatePlanAccountAction(planId, { accountId });
    setIsSubmitting(false);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Account linked to this Plan.");
    setAccountId(undefined);
    onLinked();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link an Account</DialogTitle>
          <DialogDescription>
            This is just context for where this Plan&rsquo;s spending mostly happens — it doesn&rsquo;t restrict which account a
            transaction can use.
          </DialogDescription>
        </DialogHeader>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unlinked accounts available.</p>
        ) : (
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger aria-label="Choose an account">
              <SelectValue placeholder="Choose an account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {ACCOUNT_TYPE_LABELS[a.type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleLink} disabled={!accountId || isSubmitting}>
            {isSubmitting ? "Linking…" : "Link account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
