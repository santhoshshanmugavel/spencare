"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Mail, RefreshCw } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { GmailConnectionStatus, GmailCandidateRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/spencare/form-field";
import { ConfirmDialog } from "@/components/spencare/confirm-dialog";
import { Money } from "@/components/spencare/money";
import { toastConfirmed, toastError } from "@/lib/toast";
import {
  beginGmailConnectAction,
  getGmailStatusAction,
  listGmailCandidatesAction,
  disconnectGmailAction,
  syncGmailNowAction,
  acceptGmailCandidateAction,
  rejectGmailCandidateAction,
  markGmailCandidateDuplicateAction,
  editGmailCandidateAction,
} from "../actions";

/**
 * <GmailConnectionManager> -- Phase 19's Gmail connection + review
 * surface, built in the same shape as `<AiProviderManager>`/
 * `<McpSessionManager>` (Phases 17-18): not-connected explanation+CTA,
 * connected status card, destructive action behind `ConfirmDialog`. The
 * review queue below it is new (no prior Settings surface needed a list
 * of independently-actionable items), built on the same `Card`/`Badge`/
 * `Select`/`FormField` primitives Phase 15's import review already
 * established, per the design-system-reuse rule.
 */

interface AccountOption {
  id: string;
  name: string;
  type: string;
}
interface CategoryOption {
  id: string;
  name: string;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function moneyFromMinor(amountMinor: number | null, currency: string | null) {
  if (amountMinor === null) return null;
  return DomainMoney.fromNumber(amountMinor, currency ?? "INR");
}

export function GmailConnectionManager({
  initialStatus,
  initialCandidates,
  accounts,
  categories,
  connected,
  cancelled,
  oauthError,
  masked = false,
}: {
  initialStatus: GmailConnectionStatus | null;
  initialCandidates: GmailCandidateRow[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  connected?: boolean;
  cancelled?: boolean;
  oauthError?: string;
  /** Privacy Mode (Phase 21 audit fix): candidate amounts are real financial
   * data pulled from the user's own inbox -- they must be masked exactly
   * like every other monetary surface when the user's profile has privacy
   * mode on. Previously missing here (this file rendered amounts
   * unconditionally), the one confirmed gap the Phase 21 Privacy Mode
   * audit found. */
  masked?: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (connected) toastConfirmed("Gmail connected. Sync now to start finding financial emails.");
    else if (oauthError) toastError(oauthError);
    else if (cancelled) {
      // The user declined Google's consent screen -- a choice, not an
      // error. Deliberately no toast; the branch exists so this is an
      // explicit, documented no-op rather than an unhandled case.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingCandidates = candidates.filter((c) => c.reviewStatus === "pending" || c.reviewStatus === "edited");

  async function onConnect() {
    setConnecting(true);
    try {
      await beginGmailConnectAction();
    } finally {
      setConnecting(false);
    }
  }

  async function onSyncNow() {
    setSyncing(true);
    try {
      const result = await syncGmailNowAction();
      if (!result.ok) {
        toastError(result.error.message);
        return;
      }
      toastConfirmed(`Sync complete. ${result.value.candidatesCreated} new item${result.value.candidatesCreated === 1 ? "" : "s"} found.`);
      const [fresh, freshCandidates] = await Promise.all([getGmailStatusAction(), listGmailCandidatesAction()]);
      setStatus(fresh);
      setCandidates(freshCandidates);
    } catch {
      toastError("Couldn't sync Gmail right now.");
    } finally {
      setSyncing(false);
    }
  }

  async function onDisconnectConfirm() {
    setDisconnecting(true);
    try {
      await disconnectGmailAction();
      setStatus(null);
      setCandidates([]);
      setDisconnectOpen(false);
      toastConfirmed("Gmail disconnected. Your confirmed transactions are unaffected.");
    } catch {
      toastError("Couldn't disconnect right now.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function onAccept(candidateId: string) {
    setActioningId(candidateId);
    try {
      const result = await acceptGmailCandidateAction(candidateId);
      if (!result.ok) {
        toastError(result.error.message);
        return;
      }
      setCandidates((prev) => prev.map((c) => (c.id === candidateId ? { ...c, reviewStatus: "accepted" } : c)));
      toastConfirmed("Added to your transactions.");
    } finally {
      setActioningId(null);
    }
  }

  async function onReject(candidateId: string) {
    setActioningId(candidateId);
    try {
      const result = await rejectGmailCandidateAction(candidateId);
      if (result.ok) setCandidates((prev) => prev.map((c) => (c.id === candidateId ? { ...c, reviewStatus: "rejected" } : c)));
    } finally {
      setActioningId(null);
    }
  }

  async function onMarkDuplicate(candidateId: string) {
    setActioningId(candidateId);
    try {
      const result = await markGmailCandidateDuplicateAction(candidateId);
      if (result.ok) setCandidates((prev) => prev.map((c) => (c.id === candidateId ? { ...c, reviewStatus: "matched_existing" } : c)));
    } finally {
      setActioningId(null);
    }
  }

  async function onSaveEdit(candidateId: string, edits: { accountId?: string; suggestedCategoryId?: string; normalizedAmountMinor?: number; normalizedDate?: string; normalizedMerchant?: string }) {
    setActioningId(candidateId);
    try {
      const result = await editGmailCandidateAction(candidateId, edits);
      if (result.ok) {
        setCandidates((prev) => prev.map((c) => (c.id === candidateId ? result.value : c)));
        setEditingId(null);
      } else {
        toastError(result.error.message);
      }
    } finally {
      setActioningId(null);
    }
  }

  if (!status) {
    return (
      <div className="space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Connecting Gmail lets Spencare read financial emails -- bank alerts, credit-card purchases, receipts, and bills -- and suggest transactions for you to review.</p>
          <p className="font-medium text-foreground">Spencare can:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Read emails and attachments to find financial information</li>
          </ul>
          <p className="font-medium text-foreground">Spencare cannot:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Send, delete, or modify anything in your Gmail</li>
            <li>Add a transaction without your explicit confirmation</li>
          </ul>
        </div>
        <Button size="touch" onClick={onConnect} disabled={connecting}>
          {connecting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
          {connecting ? "Redirecting…" : "Connect Gmail"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-success text-success">
              Connected
            </Badge>
            <span className="text-sm font-medium text-foreground">{status.googleEmail}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Last synced {formatDateTime(status.lastSyncAt)}
            {status.candidatesFoundLastSync !== null ? ` · ${status.candidatesFoundLastSync} item${status.candidatesFoundLastSync === 1 ? "" : "s"} found` : ""}
          </p>
          {status.syncStatus === "error" && status.lastSyncError ? (
            <div className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{status.lastSyncError}</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="touch" onClick={onSyncNow} disabled={syncing || status.syncStatus === "syncing"}>
              {syncing || status.syncStatus === "syncing" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
              {syncing || status.syncStatus === "syncing" ? "Syncing…" : "Sync now"}
            </Button>
            <Button variant="destructive" size="touch" onClick={() => setDisconnectOpen(true)}>
              Disconnect
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Needs review {pendingCandidates.length > 0 ? `(${pendingCandidates.length})` : ""}</p>
        {pendingCandidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No financial emails waiting for review.</p>
        ) : (
          <ul className="space-y-2">
            {pendingCandidates.map((candidate) => (
              <li key={candidate.id}>
                <GmailCandidateCard
                  candidate={candidate}
                  accounts={accounts}
                  categories={categories}
                  busy={actioningId === candidate.id}
                  editing={editingId === candidate.id}
                  masked={masked}
                  onStartEdit={() => setEditingId(candidate.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onAccept={() => onAccept(candidate.id)}
                  onReject={() => onReject(candidate.id)}
                  onMarkDuplicate={() => onMarkDuplicate(candidate.id)}
                  onSaveEdit={(edits) => onSaveEdit(candidate.id, edits)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect Gmail?"
        description="Spencare will stop reading your Gmail and your Gmail access will be removed. Transactions you've already added are kept."
        consequences={["Automatic financial email detection", "New sync results"]}
        confirmLabel={disconnecting ? "Disconnecting…" : "Disconnect"}
        confirmDisabled={disconnecting}
        onConfirm={onDisconnectConfirm}
      />
    </div>
  );
}

function GmailCandidateCard({
  candidate,
  accounts,
  categories,
  busy,
  editing,
  masked,
  onStartEdit,
  onCancelEdit,
  onAccept,
  onReject,
  onMarkDuplicate,
  onSaveEdit,
}: {
  candidate: GmailCandidateRow;
  accounts: AccountOption[];
  categories: CategoryOption[];
  busy: boolean;
  editing: boolean;
  masked: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onAccept: () => void;
  onReject: () => void;
  onMarkDuplicate: () => void;
  onSaveEdit: (edits: { accountId?: string; suggestedCategoryId?: string; normalizedAmountMinor?: number; normalizedDate?: string; normalizedMerchant?: string }) => void;
}) {
  const [accountId, setAccountId] = useState(candidate.accountId ?? "");
  const [categoryId, setCategoryId] = useState(candidate.suggestedCategoryId ?? "");
  const [amountDisplay, setAmountDisplay] = useState(candidate.normalizedAmountMinor ? String(Math.round(candidate.normalizedAmountMinor / 100)) : "");
  const [date, setDate] = useState(candidate.normalizedDate ?? "");
  const [merchant, setMerchant] = useState(candidate.normalizedMerchant ?? "");

  const money = moneyFromMinor(candidate.normalizedAmountMinor, candidate.currency);
  const canAccept = !candidate.accountMatchRequired && candidate.accountId !== null && candidate.suggestedCategoryId !== null && candidate.normalizedAmountMinor !== null && candidate.normalizedDate !== null;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{candidate.normalizedMerchant ?? candidate.subject ?? "Financial email"}</span>
            <Badge variant="secondary">{candidate.direction ?? candidate.candidateType}</Badge>
            {candidate.confidenceScore < 0.7 ? <Badge variant="outline">Low confidence</Badge> : null}
          </div>
          {money ? <Money value={money} masked={masked} tone={candidate.direction === "income" ? "positive" : "neutral"} /> : <span className="text-sm text-muted-foreground">Amount unknown</span>}
        </div>

        <p className="text-xs text-muted-foreground">
          From {candidate.sender ?? "unknown sender"} · {candidate.normalizedDate ?? "date unknown"} · via Gmail
        </p>

        {candidate.duplicateOfTransactionId ? (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            <span>This looks like a transaction you may already have.</span>
          </div>
        ) : null}
        {candidate.accountMatchRequired ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Choose an account before accepting.</span>
          </div>
        ) : null}

        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id={`account-${candidate.id}`} label="Account">
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id={`account-${candidate.id}`}>
                  <SelectValue placeholder="Choose an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id={`category-${candidate.id}`} label="Category">
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id={`category-${candidate.id}`}>
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id={`amount-${candidate.id}`} label="Amount (INR ₹)">
              <Input
                id={`amount-${candidate.id}`}
                inputMode="numeric"
                value={amountDisplay}
                onChange={(e) => setAmountDisplay(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </FormField>
            <FormField id={`date-${candidate.id}`} label="Date">
              <Input id={`date-${candidate.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField id={`merchant-${candidate.id}`} label="Merchant" className="sm:col-span-2">
              <Input id={`merchant-${candidate.id}`} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </FormField>
            <div className="flex gap-2 sm:col-span-2">
              <Button
                type="button"
                size="touch"
                disabled={busy}
                onClick={() =>
                  onSaveEdit({
                    accountId: accountId || undefined,
                    suggestedCategoryId: categoryId || undefined,
                    normalizedAmountMinor: amountDisplay ? Number(amountDisplay) * 100 : undefined,
                    normalizedDate: date || undefined,
                    normalizedMerchant: merchant || undefined,
                  })
                }
              >
                Save
              </Button>
              <Button type="button" variant="ghost" size="touch" onClick={onCancelEdit} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="touch" onClick={onAccept} disabled={busy || !canAccept}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
              Accept
            </Button>
            <Button variant="outline" size="touch" onClick={onStartEdit} disabled={busy}>
              Edit
            </Button>
            <Button variant="ghost" size="touch" onClick={onMarkDuplicate} disabled={busy}>
              Mark duplicate
            </Button>
            <Button variant="ghost" size="touch" onClick={onReject} disabled={busy}>
              Ignore
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
