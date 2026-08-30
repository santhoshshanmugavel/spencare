"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Repeat2 } from "lucide-react";
import { Money as DomainMoney, LOW_CONFIDENCE_THRESHOLD, ACCOUNT_TYPE_LABELS } from "@spencare/domain-core";
import type {
  AccountRow,
  CategoryRow,
  ImportBatchRow,
  ImportSummary,
  StagedTransactionRow,
} from "@spencare/domain-application";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/spencare/form-field";
import { Money } from "@/components/spencare/money";
import { ConsequentialActionPreview, type ActionPreview } from "@/components/spencare/consequential-action-preview";
import { formatMinorUnits } from "@/lib/currency-format";
import { toastError } from "@/lib/toast";
import {
  cancelImportAction,
  confirmImportAction,
  createImportBatchAction,
  listStagedTransactionsAction,
  updateStagedTransactionAction,
} from "./actions";

/**
 * `/cash-flow/import`'s wizard -- Phase 15 v1 (locked decisions #6, #2).
 * Five real steps (upload/processing/review/confirm/complete), no
 * authoritative screen to build from (screen-catalog.md: "needs to be
 * designed net-new"). Every state here maps to a REAL underlying
 * operation -- there is no simulated/fake processing step: "processing"
 * is exactly the pending duration of the one synchronous
 * `createImportBatchAction` call (locked decision #2's explicit
 * requirement: "Do not create fake progress percentages... Do not
 * simulate background processing").
 */

type WizardStep = "upload" | "processing" | "review" | "confirming" | "complete";

function formatMoney(minor: number, currency = "INR") {
  return DomainMoney.fromMinorUnits(BigInt(minor), currency as never);
}

function formatMoneyString(minor: number, currency = "INR"): string {
  const f = formatMinorUnits(BigInt(minor), currency);
  return `${f.isNegative ? "-" : ""}${f.symbol}${f.integerPart}.${f.decimalPart}`;
}

export function ImportWizard({ accounts, categories }: { accounts: AccountRow[]; categories: CategoryRow[] }) {
  const [step, setStep] = useState<WizardStep>("upload");
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? "");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [batch, setBatch] = useState<ImportBatchRow | null>(null);
  const [stagedRows, setStagedRows] = useState<StagedTransactionRow[]>([]);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;

  async function refreshStagedRows(importBatchId: string) {
    const rows = await listStagedTransactionsAction(importBatchId);
    setStagedRows(rows);
  }

  function handleUpload(formData: FormData) {
    setUploadError(null);
    setStep("processing");
    startTransition(async () => {
      const result = await createImportBatchAction(formData);
      if (!result.ok) {
        setUploadError(result.error.message);
        setStep("upload");
        return;
      }
      setBatch(result.value);
      await refreshStagedRows(result.value.id);
      setStep("review");
    });
  }

  function handleRowUpdate(stagedTransactionId: string, patch: Parameters<typeof updateStagedTransactionAction>[1]) {
    startTransition(async () => {
      const result = await updateStagedTransactionAction(stagedTransactionId, patch);
      if (!result.ok) {
        toastError(result.error.message);
        return;
      }
      setStagedRows((rows) => rows.map((r) => (r.id === stagedTransactionId ? result.value : r)));
    });
  }

  function handleConfirm() {
    if (!batch) return;
    setConfirmError(null);
    setStep("confirming");
    startTransition(async () => {
      const result = await confirmImportAction(batch.id);
      if (!result.ok) {
        // Stays on the "confirming" step -- ConsequentialActionPreview's
        // own error state renders the real message with a Retry action,
        // rather than silently returning to review and losing the error.
        setConfirmError(result.error.message);
        return;
      }
      setSummary(result.value.summary);
      setStep("complete");
    });
  }

  function handleCancel() {
    if (!batch) return;
    startTransition(async () => {
      await cancelImportAction(batch.id);
      resetWizard();
    });
  }

  function resetWizard() {
    setBatch(null);
    setStagedRows([]);
    setSummary(null);
    setConfirmError(null);
    setUploadError(null);
    setStep("upload");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const acceptedOrEdited = stagedRows.filter((r) => r.review_status === "accepted" || r.review_status === "edited");
  const willImportCount = acceptedOrEdited.length;
  const missingCategoryCount = acceptedOrEdited.filter((r) => !r.suggested_category_id).length;
  const incomeTotal = acceptedOrEdited.filter((r) => r.staged_transaction_type === "income").reduce((s, r) => s + r.normalized_amount_minor, 0);
  const expenseTotal = acceptedOrEdited.filter((r) => r.staged_transaction_type === "expense").reduce((s, r) => s + r.normalized_amount_minor, 0);
  const skippedCount = stagedRows.length - willImportCount;

  const preview: ActionPreview = {
    commandType: "confirmImport",
    summary: `Import ${willImportCount} transaction${willImportCount === 1 ? "" : "s"} into ${selectedAccount?.name ?? "this account"}`,
    fields: [
      {
        label: "Destination account",
        value: selectedAccount ? `${selectedAccount.name} (${ACCOUNT_TYPE_LABELS[selectedAccount.type]})` : "—",
        emphasis: true,
      },
      { label: "Transactions to import", value: String(willImportCount) },
      { label: "Total income", value: formatMoneyString(incomeTotal) },
      { label: "Total expenses", value: formatMoneyString(expenseTotal) },
      ...(skippedCount > 0 ? [{ label: "Rows skipped (rejected or not yet reviewed)", value: String(skippedCount) }] : []),
    ],
    undoable: false,
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">Import a statement</h1>

      {step === "upload" ? (
        <UploadStep
          accounts={accounts}
          accountId={accountId}
          onAccountChange={setAccountId}
          onSubmit={handleUpload}
          fileInputRef={fileInputRef}
          error={uploadError}
          isPending={isPending}
        />
      ) : null}

      {step === "processing" ? <ProcessingStep /> : null}

      {step === "review" && batch ? (
        <ReviewStep
          stagedRows={stagedRows}
          categories={categories}
          categoryById={categoryById}
          onRowUpdate={handleRowUpdate}
          onContinue={() => setStep("confirming")}
          onCancel={handleCancel}
          willImportCount={willImportCount}
          missingCategoryCount={missingCategoryCount}
          isPending={isPending}
        />
      ) : null}

      {step === "confirming" ? (
        <div className="space-y-4">
          <ConsequentialActionPreview
            preview={preview}
            state={isPending ? "confirming" : confirmError ? "error" : "proposed"}
            errorMessage={confirmError ?? undefined}
            onConfirm={handleConfirm}
            onCancel={() => setStep("review")}
            onRetry={handleConfirm}
          />
          {missingCategoryCount > 0 ? (
            <p className="flex items-center gap-2 text-sm text-warning" role="alert">
              <AlertTriangle className="size-4" aria-hidden="true" />
              {missingCategoryCount} accepted row{missingCategoryCount === 1 ? "" : "s"} still need a category before this can be confirmed.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "complete" && summary ? (
        <CompleteStep summary={summary} account={selectedAccount} onImportAnother={resetWizard} />
      ) : null}
    </div>
  );
}

function UploadStep({
  accounts,
  accountId,
  onAccountChange,
  onSubmit,
  fileInputRef,
  error,
  isPending,
}: {
  accounts: AccountRow[];
  accountId: string;
  onAccountChange: (v: string) => void;
  onSubmit: (formData: FormData) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  error: string | null;
  isPending: boolean;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;

  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        {accounts.length === 0 ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">Add a bank, cash, or credit card account before importing a statement.</p>
            <Button asChild size="touch">
              <Link href="/settings/accounts">Add an account</Link>
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Built explicitly from the file input's own `.files`,
              // rather than `new FormData(e.currentTarget)` -- jsdom's
              // FormData-from-form-element constructor does not reliably
              // read `<input type="file">` values (confirmed live during
              // Phase 15 testing), unlike a real browser. Reading the ref
              // directly is portable to both.
              const file = fileInputRef.current?.files?.[0] ?? null;
              if (!file || file.size === 0) {
                setFileError("Choose a CSV or PDF file to upload.");
                return;
              }
              setFileError(null);
              const formData = new FormData();
              formData.set("file", file);
              formData.set("accountId", accountId);
              onSubmit(formData);
            }}
            noValidate
            className="space-y-4"
          >
            <FormField id="import-account" label="Which account is this statement for?">
              <Select value={accountId} onValueChange={onAccountChange} name="accountId">
                <SelectTrigger id="import-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {ACCOUNT_TYPE_LABELS[a.type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {selectedAccount?.type === "credit_card" ? (
              <p className="text-xs text-muted-foreground">
                This is a credit card statement -- rows will be imported as credit card spending (increasing what you
                owe), never as bank spending. Any row this statement marks as income or a refund can&apos;t be
                imported here; remove those rows before confirming.
              </p>
            ) : null}
            <FormField
              id="import-file"
              label="Statement file"
              hint="CSV or PDF, up to 10 MB."
              error={fileError ?? error ?? undefined}
            >
              <Input id="import-file" name="file" type="file" ref={fileInputRef} accept=".csv,.pdf,text/csv,application/pdf" required />
            </FormField>

            <Button type="submit" size="touch" className="w-full" disabled={isPending}>
              {isPending ? "Uploading…" : "Upload and process"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ProcessingStep() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Processing your statement — this can take a moment for larger files.</p>
      </CardContent>
    </Card>
  );
}

function ReviewStep({
  stagedRows,
  categories,
  categoryById,
  onRowUpdate,
  onContinue,
  onCancel,
  willImportCount,
  missingCategoryCount,
  isPending,
}: {
  stagedRows: StagedTransactionRow[];
  categories: CategoryRow[];
  categoryById: Map<string, CategoryRow>;
  onRowUpdate: (id: string, patch: Parameters<typeof updateStagedTransactionAction>[1]) => void;
  onContinue: () => void;
  onCancel: () => void;
  willImportCount: number;
  missingCategoryCount: number;
  isPending: boolean;
}) {
  if (stagedRows.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">No transactions were found in this file.</p>
          <Button variant="outline" size="touch" onClick={onCancel}>
            Start over
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-foreground">Review {stagedRows.length} transaction{stagedRows.length === 1 ? "" : "s"}</h2>
      <p className="text-sm text-muted-foreground">
        Accept, reject, or edit each row. Low-confidence rows need your explicit review before they can be imported.
      </p>
      <ul className="space-y-3">
        {stagedRows.map((row) => (
          <li key={row.id}>
            <StagedRowCard row={row} categories={categories} category={row.suggested_category_id ? categoryById.get(row.suggested_category_id) : undefined} onUpdate={(patch) => onRowUpdate(row.id, patch)} />
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button variant="outline" size="touch" onClick={onCancel} disabled={isPending}>
          Cancel import
        </Button>
        <Button size="touch" onClick={onContinue} disabled={isPending || willImportCount === 0}>
          Continue ({willImportCount} to import)
        </Button>
      </div>
      {missingCategoryCount > 0 ? (
        <p className="text-xs text-muted-foreground">{missingCategoryCount} accepted row{missingCategoryCount === 1 ? "" : "s"} still need a category.</p>
      ) : null}
    </div>
  );
}

function StagedRowCard({
  row,
  categories,
  category,
  onUpdate,
}: {
  row: StagedTransactionRow;
  categories: CategoryRow[];
  category: CategoryRow | undefined;
  onUpdate: (patch: Parameters<typeof updateStagedTransactionAction>[1]) => void;
}) {
  const isLowConfidence = row.confidence_score < LOW_CONFIDENCE_THRESHOLD;
  const isTouched = row.review_status === "accepted" || row.review_status === "edited";
  const rowLabel = `${row.staged_transaction_type === "income" ? "Income" : "Expense"} of ${formatMoney(row.normalized_amount_minor).toString()} from ${row.normalized_merchant ?? "an unknown merchant"} on ${row.normalized_date}`;

  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium text-foreground">{row.normalized_merchant ?? "Unknown merchant"}</p>
            <p className="text-xs text-muted-foreground">{row.normalized_date}</p>
          </div>
          <Money
            value={formatMoney(row.normalized_amount_minor)}
            tone={row.staged_transaction_type === "income" ? "positive" : "negative"}
            size="numeric"
            aria-label={rowLabel}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={row.staged_transaction_type === "income" ? "secondary" : "outline"}>
            {row.staged_transaction_type === "income" ? "Income" : "Expense"}
          </Badge>
          {isLowConfidence && !isTouched ? (
            <Badge variant="destructive">
              <AlertTriangle className="size-3" aria-hidden="true" /> Needs review
            </Badge>
          ) : null}
          {row.duplicate_of_transaction_id ? (
            <Badge variant="destructive">
              <Repeat2 className="size-3" aria-hidden="true" /> Possible duplicate
            </Badge>
          ) : null}
          <Badge variant={isTouched ? "default" : row.review_status === "rejected" ? "secondary" : "outline"}>
            {row.review_status === "pending" ? "Not reviewed" : row.review_status === "accepted" ? "Accepted" : row.review_status === "edited" ? "Edited" : "Rejected"}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={row.staged_transaction_type} onValueChange={(v) => onUpdate({ stagedTransactionType: v as "income" | "expense", reviewStatus: "edited" })}>
            <SelectTrigger aria-label={`Direction for ${row.normalized_merchant ?? "this row"}`} className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
            </SelectContent>
          </Select>
          <Select value={row.suggested_category_id ?? ""} onValueChange={(v) => onUpdate({ suggestedCategoryId: v, reviewStatus: row.review_status === "pending" ? "edited" : row.review_status })}>
            <SelectTrigger aria-label={`Category for ${row.normalized_merchant ?? "this row"}`} className="w-40">
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
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={row.review_status === "accepted" ? "default" : "outline"}
            aria-pressed={row.review_status === "accepted"}
            onClick={() => onUpdate({ reviewStatus: "accepted" })}
          >
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant={row.review_status === "rejected" ? "default" : "outline"}
            aria-pressed={row.review_status === "rejected"}
            onClick={() => onUpdate({ reviewStatus: "rejected" })}
          >
            Reject
          </Button>
        </div>
        {category ? <p className="text-xs text-muted-foreground">Category: {category.name}</p> : null}
        {!category && isTouched ? <p className="text-xs text-destructive">A category is required before this row can be confirmed.</p> : null}
      </CardContent>
    </Card>
  );
}

function CompleteStep({ summary, account, onImportAnother }: { summary: ImportSummary; account: AccountRow | null; onImportAnother: () => void }) {
  return (
    <Card>
      <CardContent className="space-y-4 py-8 text-center">
        <p className="text-lg font-medium text-foreground">Import complete</p>
        <dl className="mx-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-2 text-left text-sm">
          <dt className="text-muted-foreground">Imported</dt>
          <dd className="text-foreground">{summary.imported}</dd>
          <dt className="text-muted-foreground">Skipped</dt>
          <dd className="text-foreground">{summary.skipped}</dd>
          <dt className="text-muted-foreground">Flagged as duplicates</dt>
          <dd className="text-foreground">{summary.duplicatesSkipped}</dd>
          <dt className="text-muted-foreground">Account</dt>
          <dd className="text-foreground">{account?.name ?? "—"}</dd>
        </dl>
        <div className="flex justify-center gap-2 pt-2">
          <Button asChild size="touch">
            <Link href="/cash-flow/transactions">View transactions</Link>
          </Button>
          <Button variant="outline" size="touch" onClick={onImportAnother}>
            Import another statement
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
