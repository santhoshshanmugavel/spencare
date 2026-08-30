"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2, ShieldAlert, Lock, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { exportUserDataAction, deleteAccountAction } from "../actions";

/**
 * <DataBackupManager> -- Phase 20's Data & Backup UI (SP-317: hub row
 * pattern; SP-319: delete-consequences modal, reusing its exact
 * inverted button-order convention -- destructive action outline/red as
 * "Verify & delete," safe action solid-primary as "Close," same as
 * `<ConfirmDialog>` already established elsewhere; SP-320: export
 * checklist + encryption-assurance copy).
 *
 * Two disclosed deviations from the visual design, both already
 * documented in the domain layer: export delivers immediately (no
 * "email in 5-6 days" -- no infrastructure exists to keep that promise),
 * and account deletion's re-verification step (SP-020/021) is a typed
 * email match plus existing 2FA, not a new email-OTP code.
 */

type DeleteStep = "closed" | "consequences" | "verify";

export function DataBackupManager({ accountEmail, twoFactorEnabled }: { accountEmail: string; twoFactorEnabled: boolean }) {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>("closed");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  async function onExport() {
    setExporting(true);
    try {
      const bundle = await exportUserDataAction();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `spencare-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExported(true);
      toastConfirmed("Your data export has downloaded.");
    } catch {
      toastError("Couldn't export your data right now. Try again.");
    } finally {
      setExporting(false);
    }
  }

  function closeDeleteFlow() {
    setDeleteStep("closed");
    setConfirmEmail("");
    setTwoFactorCode("");
    setDeleteError(undefined);
  }

  async function onConfirmDelete() {
    setDeleteError(undefined);
    setDeleting(true);
    try {
      const result = await deleteAccountAction({ confirmEmail, twoFactorCode: twoFactorEnabled ? twoFactorCode : undefined });
      if (!result.ok) {
        setDeleteError(result.error.message);
        return;
      }
      toastConfirmed("Your account has been deleted.");
      router.push("/login");
    } catch {
      setDeleteError("Couldn't delete your account. Try again or contact support.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="divide-y divide-border">
      <div className="flex items-start justify-between gap-4 py-5">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Download className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Export my data</p>
            <p className="text-sm text-muted-foreground">Download a copy of your accounts, transactions, budgets, goals, bills, and Spensa conversations.</p>
            {exported ? (
              <p className="mt-1 flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Export downloaded
              </p>
            ) : null}
          </div>
        </div>
        <Button variant="link" className="shrink-0 px-0" onClick={onExport} disabled={exporting}>
          {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {exporting ? "Exporting…" : "Export"}
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 py-5">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Delete my account</p>
            <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
          </div>
        </div>
        <Button variant="link" className="shrink-0 px-0 text-destructive" onClick={() => setDeleteStep("consequences")}>
          Delete
        </Button>
      </div>

      {/* Step 1 (SP-319): consequences, inverted button weight -- destructive outline, safe solid. */}
      <Dialog open={deleteStep === "consequences"} onOpenChange={(open) => !open && closeDeleteFlow()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete my account?</DialogTitle>
            <DialogDescription className="font-medium text-destructive">This action is permanent and cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">You&apos;ll lose access to:</p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {["Transaction history and insights", "All accounts and balances", "AI conversations and recommendations", "Budgets, goals, and saved data"].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setDeleteStep("verify")}>
              Verify & delete
            </Button>
            <Button onClick={closeDeleteFlow} autoFocus>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2 (SP-020/021, adapted -- see file header comment): typed-email confirmation, plus 2FA when enabled. */}
      <Dialog open={deleteStep === "verify"} onOpenChange={(open) => !open && closeDeleteFlow()}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Verify it&apos;s you</DialogTitle>
            <DialogDescription>Type your account email to confirm{twoFactorEnabled ? ", and enter your 2FA code." : "."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <FormField id="delete-confirm-email" label={`Type "${accountEmail}" to confirm`} error={deleteError && !twoFactorEnabled ? deleteError : undefined}>
              <Input
                id="delete-confirm-email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoComplete="off"
                aria-invalid={!!deleteError}
                aria-describedby={deleteError ? errorId("delete-confirm-email") : undefined}
              />
            </FormField>
            {twoFactorEnabled ? (
              <FormField id="delete-2fa-code" label="2FA code" error={deleteError}>
                <Input
                  id="delete-2fa-code"
                  inputMode="numeric"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/[^0-9]/g, ""))}
                  aria-invalid={!!deleteError}
                  aria-describedby={deleteError ? errorId("delete-2fa-code") : undefined}
                />
              </FormField>
            ) : null}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden="true" />
              Your data is deleted immediately and cannot be recovered.
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={onConfirmDelete}
              disabled={deleting || confirmEmail.trim().length === 0}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </Button>
            <Button onClick={closeDeleteFlow} disabled={deleting} autoFocus>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
