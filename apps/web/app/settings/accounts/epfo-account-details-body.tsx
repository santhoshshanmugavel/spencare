"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  addEpfoEmploymentSchema,
  upsertEpfoContributionProfileSchema,
  recordEpfoContributionSchema,
  correctEpfoBalanceSchema,
  type AddEpfoEmploymentInput,
  type UpsertEpfoContributionProfileInput,
  type RecordEpfoContributionInput,
  type CorrectEpfoBalanceInput,
} from "@spencare/validation";
import { Money as DomainMoney, type ParsedPassbookResult } from "@spencare/domain-core";
import { Money } from "@/components/spencare/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, errorId } from "@/components/spencare/form-field";
import { LoaderBlock } from "@/components/spencare/loader";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput } from "@/lib/money-input";
import {
  getEpfoOverviewAction,
  addEpfoEmploymentAction,
  endEpfoEmploymentAction,
  upsertEpfoContributionProfileAction,
  recordEpfoContributionAction,
  correctEpfoBalanceAction,
  importEpfoPassbookAction,
  confirmEpfoPassbookImportAction,
} from "./actions";

/**
 * EPFO Account Details body (Phase 3).
 *
 * Rendered inside `AccountDetailsSheet` when `account.type === "epfo"`.
 * Shows:
 *   - Total EPFO value + per-component breakdown with "Not available"
 *     for ledger-unknown components (never a false zero).
 *   - Activity (ledger entries) with correct signs and dedicated event
 *     labels (never ordinary expense categories).
 *   - Employment section with masked member IDs and an inline add form.
 *   - Expected contribution profiles with a per-kind inline editor.
 *
 * No withdrawal action -- Phase 7. The spec forbids rendering dead buttons.
 *
 * Mutations go through server actions -> application commands ->
 * SECURITY DEFINER RPCs that audit atomically.
 */

type OverviewPayload = Awaited<ReturnType<typeof getEpfoOverviewAction>>;

export function EpfoAccountDetailsBody({
  accountId,
  currency,
  masked,
}: {
  accountId: string;
  currency: string;
  masked: boolean;
}) {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddEmployment, setShowAddEmployment] = useState(false);
  const [editingProfileKind, setEditingProfileKind] = useState<"employee_epf" | "employer_epf" | "eps" | null>(null);

  const [showRecordContribution, setShowRecordContribution] = useState(false);
  const [showCorrectBalance, setShowCorrectBalance] = useState(false);

  const [importPhase, setImportPhase] = useState<"idle" | "processing" | "review" | "confirming">("idle");
  const [importBatchId, setImportBatchId] = useState<string | null>(null);
  const [importParsedResult, setImportParsedResult] = useState<ParsedPassbookResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isPending, startTransition] = useTransition();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await getEpfoOverviewAction(accountId);
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load EPFO details.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  if (loading && !overview) {
    return <LoaderBlock message="Loading EPFO details…" tone="muted" className="py-10" />;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!overview) return null;

  const totalMoney = DomainMoney.fromMinorUnits(BigInt(overview.balance.totalMinor), currency);
  const hasEntries = overview.balance.entryCount > 0;

  // Component knowledge: which categories actually have ledger entries?
  // (Unknown != zero -- spec Part 11.)
  const kinds = componentKnowledge(overview);

  return (
    <div className="space-y-6 pt-2">
      {/* --- Header totals ---------------------------------------- */}
      <section aria-label="EPFO balance" className="rounded-2xl border bg-card px-4 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total EPFO value</p>
            <div className="mt-1">
              <Money value={totalMoney} masked={masked} size="hero" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              EPFO value is not the same as immediately spendable cash.
            </p>
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <div>
              Last verified
              <br />
              <span className="font-medium text-foreground">
                {overview.lastVerifiedAt ? formatShortDate(overview.lastVerifiedAt) : "Not available"}
              </span>
            </div>
            <div className="mt-1">
              Source: <span className="font-medium text-foreground">Manual</span>
            </div>
          </div>
        </div>
      </section>

      {/* --- This month contributions ----------------------------- */}
      {overview.currentPeriod.summary.anyEvents ? (
        <section aria-label="This month's contributions">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            This month — {formatPeriodLabel(overview.currentPeriod.periodKey)}
          </h3>
          <ThisMonthSummary summary={overview.currentPeriod.summary} currency={currency} masked={masked} />
        </section>
      ) : null}

      {/* --- Component breakdown --------------------------------- */}
      <section aria-label="Balance components">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Balance components</h3>
        <div className="divide-y divide-border rounded-xl border bg-card px-4">
          <ComponentRow label="Opening balance" masked={masked} currency={currency}
            minor={kinds.openingBalance ? overview.balance.openingBalanceMinor : null} />
          <ComponentRow label="Employee EPF" masked={masked} currency={currency}
            minor={kinds.employeeEpf ? overview.balance.employeeEpfMinor : null} />
          <ComponentRow label="Employer EPF" masked={masked} currency={currency}
            minor={kinds.employerEpf ? overview.balance.employerEpfMinor : null} />
          <ComponentRow label="Interest" masked={masked} currency={currency}
            minor={kinds.interest ? overview.balance.interestMinor : null} />
          <ComponentRow label="EPS" masked={masked} currency={currency}
            minor={kinds.eps ? overview.balance.epsMinor : null} />
          <ComponentRow label="Adjustments" masked={masked} currency={currency}
            minor={kinds.adjustments ? overview.balance.adjustmentsMinor : null} />
        </div>
      </section>

      {/* --- Contribution profiles ------------------------------- */}
      <section aria-label="Expected contributions">
        <div className="mb-2 flex items-end justify-between">
          <h3 className="text-sm font-semibold text-foreground">Expected monthly contributions</h3>
        </div>
        <div className="rounded-xl border bg-card p-4">
          {overview.contributionProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Expected contribution tracking is not fully configured.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {overview.contributionProfiles.filter((p) => p.is_active).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{labelForKind(p.kind)}</p>
                    <p className="text-xs text-muted-foreground">{describeProfileMode(p, currency, masked)}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditingProfileKind(p.kind)}>Edit</Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {(["employee_epf", "employer_epf", "eps"] as const)
              .filter((k) => !overview.contributionProfiles.some((p) => p.is_active && p.kind === k))
              .map((k) => (
                <Button key={k} size="sm" variant="outline" onClick={() => setEditingProfileKind(k)}>
                  Add {labelForKind(k).toLowerCase()}
                </Button>
              ))}
          </div>
          {editingProfileKind && overview.employments.find((e) => e.is_active) ? (
            <ContributionProfileForm
              accountId={accountId}
              employmentId={overview.employments.find((e) => e.is_active)?.id ?? null}
              kind={editingProfileKind}
              currency={currency}
              onClose={() => setEditingProfileKind(null)}
              onSaved={() => {
                setEditingProfileKind(null);
                void refresh();
              }}
            />
          ) : editingProfileKind ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Add an active employment first so the profile can be scoped to it.
            </p>
          ) : null}
        </div>
      </section>

      {/* --- Record contribution --------------------------------- */}
      <section aria-label="Record contribution">
        <div className="mb-2 flex items-end justify-between">
          <h3 className="text-sm font-semibold text-foreground">Record contribution</h3>
          {!showRecordContribution && (
            <Button size="sm" variant="outline" onClick={() => setShowRecordContribution(true)}>
              Add entry
            </Button>
          )}
        </div>
        <div className="rounded-xl border bg-card">
          {!showRecordContribution ? (
            <p className="p-4 text-sm text-muted-foreground">
              Record an actual contribution to track what EPFO received this period.
            </p>
          ) : (
            <RecordContributionForm
              accountId={accountId}
              employmentId={overview.employments.find((e) => e.is_active)?.id ?? null}
              currency={currency}
              onClose={() => setShowRecordContribution(false)}
              onSaved={() => { setShowRecordContribution(false); void refresh(); }}
            />
          )}
        </div>
      </section>

      {/* --- Import passbook ------------------------------------ */}
      <section aria-label="Import passbook">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const activeEmploymentId = overview.employments.find((emp) => emp.is_active)?.id ?? null;
            setImportPhase("processing");
            void (async () => {
              const fd = new FormData();
              fd.append("file", file);
              const result = await importEpfoPassbookAction(accountId, activeEmploymentId, fd);
              if (!result.ok) {
                setImportPhase("idle");
                toastError(result.error.message);
                return;
              }
              setImportBatchId(result.value.batchId);
              setImportParsedResult(result.value.parsed);
              setImportPhase("review");
            })();
          }}
        />
        <div className="mb-2 flex items-end justify-between">
          <h3 className="text-sm font-semibold text-foreground">Import passbook</h3>
          {importPhase === "idle" && (
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              Import PDF
            </Button>
          )}
        </div>
        <div className="rounded-xl border bg-card">
          {importPhase === "idle" && (
            <p className="p-4 text-sm text-muted-foreground">
              Upload a UAN portal passbook PDF to bulk-import contributions and interest.
              Duplicate entries are automatically skipped.
            </p>
          )}
          {importPhase === "processing" && (
            <LoaderBlock message="Reading passbook…" tone="muted" className="py-6" />
          )}
          {(importPhase === "review" || importPhase === "confirming") && importParsedResult && (
            <div className="space-y-3 p-4">
              <p className="text-sm font-medium text-foreground">
                Found {importParsedResult.entries.length}{" "}
                {importParsedResult.entries.length === 1 ? "period" : "periods"}.
                Review and confirm to add them to your ledger.
              </p>
              {importParsedResult.memberName && (
                <p className="text-xs text-muted-foreground">
                  Member: {importParsedResult.memberName}
                </p>
              )}
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 pr-3 text-left font-medium">Period</th>
                      <th className="py-2 pr-3 text-right font-medium">Emp EPF</th>
                      <th className="py-2 pr-3 text-right font-medium">Empr EPF</th>
                      <th className="py-2 pr-3 text-right font-medium">EPS</th>
                      <th className="py-2 text-right font-medium">Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importParsedResult.entries.map((entry) => (
                      <tr key={entry.periodKey} className="border-b last:border-0">
                        <td className="py-2 pr-3 tabular-nums">{entry.periodKey}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {entry.employeeEpfMinor ? (
                            <Money value={DomainMoney.fromMinorUnits(BigInt(entry.employeeEpfMinor), currency)} masked={masked} size="numeric" />
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {entry.employerEpfMinor ? (
                            <Money value={DomainMoney.fromMinorUnits(BigInt(entry.employerEpfMinor), currency)} masked={masked} size="numeric" />
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {entry.epsMinor ? (
                            <Money value={DomainMoney.fromMinorUnits(BigInt(entry.epsMinor), currency)} masked={masked} size="numeric" />
                          ) : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {entry.interestMinor ? (
                            <Money value={DomainMoney.fromMinorUnits(BigInt(entry.interestMinor), currency)} masked={masked} size="numeric" />
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importParsedResult.warnings.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {importParsedResult.warnings[0]}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={importPhase === "confirming"}
                  onClick={() => {
                    if (!importBatchId) return;
                    const activeEmploymentId = overview.employments.find((emp) => emp.is_active)?.id ?? null;
                    setImportPhase("confirming");
                    void (async () => {
                      const result = await confirmEpfoPassbookImportAction({
                        importBatchId,
                        accountId,
                        employmentId: activeEmploymentId,
                      });
                      if (!result.ok) {
                        setImportPhase("review");
                        toastError(result.error.message);
                        return;
                      }
                      const { inserted, skipped } = result.value;
                      toastConfirmed(
                        skipped > 0
                          ? `Added ${inserted} ${inserted === 1 ? "entry" : "entries"}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}.`
                          : `Added ${inserted} ${inserted === 1 ? "entry" : "entries"}.`,
                      );
                      setImportPhase("idle");
                      setImportBatchId(null);
                      setImportParsedResult(null);
                      void refresh();
                    })();
                  }}
                >
                  {importPhase === "confirming" ? "Confirming…" : "Confirm import"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={importPhase === "confirming"}
                  onClick={() => {
                    setImportPhase("idle");
                    setImportBatchId(null);
                    setImportParsedResult(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* --- Employment ------------------------------------------ */}
      <section aria-label="Employment">
        <div className="mb-2 flex items-end justify-between">
          <h3 className="text-sm font-semibold text-foreground">Employment</h3>
          <Button size="sm" variant="outline" onClick={() => setShowAddEmployment((v) => !v)}>
            {showAddEmployment ? "Cancel" : "Add employment"}
          </Button>
        </div>
        <div className="rounded-xl border bg-card">
          {overview.employments.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No employments added yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {overview.employments.map((e) => (
                <li key={e.id} className="flex items-start justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">
                      {e.employer_name}
                      {!e.is_active ? <span className="ml-2 text-xs text-muted-foreground">(ended)</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatShortDate(e.start_date)}
                      {e.end_date ? ` – ${formatShortDate(e.end_date)}` : " – Present"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Member ID: {e.member_id ? maskMemberId(e.member_id) : "Not added"}
                    </p>
                  </div>
                  {e.is_active ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          const today = new Date().toISOString().slice(0, 10);
                          const r = await endEpfoEmploymentAction({ employmentId: e.id, endDate: today });
                          if (!r.ok) {
                            toastError(r.error.message);
                            return;
                          }
                          toastConfirmed("Employment ended.");
                          void refresh();
                        });
                      }}
                    >
                      End
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {showAddEmployment ? (
            <AddEmploymentForm
              accountId={accountId}
              onClose={() => setShowAddEmployment(false)}
              onSaved={() => {
                setShowAddEmployment(false);
                void refresh();
              }}
            />
          ) : null}
        </div>
      </section>

      {/* --- Activity -------------------------------------------- */}
      <section aria-label="Activity">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Activity</h3>
        <div className="rounded-xl border bg-card">
          {!hasEntries ? (
            <p className="p-4 text-sm text-muted-foreground">
              No activity yet. An opening balance of zero was recorded; add contributions, interest, or imports to see them here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {overview.entries.map((e) => {
                const amountMoney = DomainMoney.fromMinorUnits(BigInt(e.amountMinor), e.currency);
                return (
                  <li key={e.id} className="flex items-center justify-between p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{labelForEntryType(e.entryType)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatShortDate(e.occurredAt)}
                        {e.description ? ` · ${e.description}` : ""}
                      </p>
                    </div>
                    <div className={e.amountMinor >= 0 ? "text-success" : "text-destructive"}>
                      {e.amountMinor >= 0 ? "+" : ""}
                      <Money value={amountMoney} masked={masked} size="numeric" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
      {/* --- Correct balance ------------------------------------- */}
      <section aria-label="Correct balance">
        <div className="mb-2 flex items-end justify-between">
          <h3 className="text-sm font-semibold text-foreground">Correct balance</h3>
          {!showCorrectBalance && (
            <Button size="sm" variant="outline" onClick={() => setShowCorrectBalance(true)}>
              Adjust
            </Button>
          )}
        </div>
        <div className="rounded-xl border bg-card">
          {!showCorrectBalance ? (
            <p className="p-4 text-sm text-muted-foreground">
              Write an adjustment entry when your EPFO records don't match.
              This creates a new ledger entry — original entries are never edited.
            </p>
          ) : (
            <CorrectBalanceForm
              accountId={accountId}
              currentTotalMinor={overview.balance.totalMinor}
              currency={currency}
              onClose={() => setShowCorrectBalance(false)}
              onSaved={() => { setShowCorrectBalance(false); void refresh(); }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function componentKnowledge(overview: OverviewPayload) {
  const k = {
    openingBalance: false,
    employeeEpf: false,
    employerEpf: false,
    interest: false,
    eps: false,
    adjustments: false,
  };
  for (const e of overview.entries) {
    switch (e.entryType) {
      case "opening_balance": k.openingBalance = true; break;
      case "employee_contribution": k.employeeEpf = true; break;
      case "employer_epf_contribution": k.employerEpf = true; break;
      case "interest": k.interest = true; break;
      case "eps_contribution": k.eps = true; break;
      case "adjustment": k.adjustments = true; break;
      default: break;
    }
  }
  return k;
}

function ComponentRow({ label, minor, currency, masked }: { label: string; minor: string | null; currency: string; masked: boolean }) {
  if (minor === null) {
    return (
      <div className="flex items-center justify-between py-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm text-muted-foreground italic">Not available</span>
      </div>
    );
  }
  const money = DomainMoney.fromMinorUnits(BigInt(minor), currency);
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Money value={money} masked={masked} size="numeric" />
    </div>
  );
}

function labelForKind(kind: "employee_epf" | "employer_epf" | "eps"): string {
  switch (kind) {
    case "employee_epf": return "Employee EPF";
    case "employer_epf": return "Employer EPF";
    case "eps": return "EPS";
  }
}

function labelForEntryType(entry: string): string {
  switch (entry) {
    case "opening_balance": return "Opening balance";
    case "employee_contribution": return "Employee contribution";
    case "employer_epf_contribution": return "Employer EPF contribution";
    case "eps_contribution": return "EPS contribution";
    case "interest": return "Interest";
    case "transfer_in": return "Transfer in";
    case "transfer_out": return "Transfer out";
    case "withdrawal": return "Withdrawal";
    case "final_settlement": return "Final settlement";
    case "adjustment": return "Adjustment";
    default: return entry;
  }
}

function describeProfileMode(p: OverviewPayload["contributionProfiles"][number], currency: string, masked: boolean): string {
  switch (p.mode) {
    case "fixed": {
      const amt = p.amount_minor != null ? DomainMoney.fromMinorUnits(BigInt(p.amount_minor), currency) : null;
      if (!amt) return "Fixed amount (not set)";
      return `Fixed ${masked ? "₹***" : formatMoneyShort(amt)} per month`;
    }
    case "percent": {
      const pct = p.percent_den && p.percent_num != null ? ((p.percent_num / p.percent_den) * 100).toFixed(2).replace(/\.00$/, "") : null;
      return `${pct ?? "?"}% of base`;
    }
    case "imported": return "From imported passbook";
    case "none": return "Not tracked";
  }
}

function formatMoneyShort(m: DomainMoney): string {
  const major = Number(m.amountMinorUnits) / 100;
  return `₹${major.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function maskMemberId(id: string): string {
  if (id.length <= 4) return "••••";
  return "••••" + id.slice(-4);
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

// ============================================================
// Add employment form
// ============================================================

function AddEmploymentForm({ accountId, onClose, onSaved }: { accountId: string; onClose: () => void; onSaved: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(addEpfoEmploymentSchema),
    defaultValues: {
      accountId,
      employerName: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: null,
      memberId: "",
      notes: "",
    },
  });

  async function onSubmit(data: AddEpfoEmploymentInput) {
    const result = await addEpfoEmploymentAction({
      ...data,
      endDate: data.endDate ?? null,
      memberId: data.memberId?.trim() || null,
      notes: data.notes?.trim() || null,
    });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Employment added.");
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3 border-t p-4">
      <FormField id="emp-name" label="Employer" error={errors.employerName?.message}>
        <Input id="emp-name" placeholder="Company A" {...register("employerName")}
          aria-invalid={!!errors.employerName}
          aria-describedby={errors.employerName ? errorId("emp-name") : undefined} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField id="emp-start" label="Start date" error={errors.startDate?.message}>
          <Input id="emp-start" type="date" {...register("startDate")} />
        </FormField>
        <FormField id="emp-end" label="End date (optional)" error={errors.endDate?.message}>
          <Input id="emp-end" type="date" {...register("endDate", { setValueAs: (v) => (v === "" ? null : v) })} />
        </FormField>
      </div>
      <FormField id="emp-member" label="Member ID (optional)" error={errors.memberId?.message}>
        <Input id="emp-member" placeholder="MH/BAN/00000000/000/0000000" {...register("memberId")} />
      </FormField>
      <FormField id="emp-notes" label="Notes (optional)" error={errors.notes?.message}>
        <Textarea id="emp-notes" rows={2} {...register("notes")} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save employment"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

// ============================================================
// Contribution profile form
// ============================================================

function ContributionProfileForm({
  accountId,
  employmentId,
  kind,
  currency,
  onClose,
  onSaved,
}: {
  accountId: string;
  employmentId: string | null;
  kind: "employee_epf" | "employer_epf" | "eps";
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"fixed" | "percent" | "imported" | "none">("fixed");

  const amountField = useMoneyField("", currency);
  const baseField = useMoneyField("", currency);

  const {
    handleSubmit,
    control,
    register,
    formState: { errors, isSubmitting },
    getValues,
  } = useForm<UpsertEpfoContributionProfileInput>({
    resolver: zodResolver(upsertEpfoContributionProfileSchema),
    defaultValues: {
      accountId,
      employmentId,
      kind,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      mode: "fixed",
      amountMinor: 0,
    } as UpsertEpfoContributionProfileInput,
  });

  async function onSubmit() {
    const v = getValues();
    // Rebuild the input per the selected mode so Zod's discriminated
    // union gets exactly the right shape (no leftover fields from a
    // prior mode selection).
    let input: UpsertEpfoContributionProfileInput;
    const common = { accountId, employmentId, kind, effectiveFrom: v.effectiveFrom };
    switch (mode) {
      case "fixed":
        input = { ...common, mode: "fixed", amountMinor: v.mode === "fixed" ? v.amountMinor : 0 };
        break;
      case "percent":
        input = {
          ...common,
          mode: "percent",
          percentNum: v.mode === "percent" ? v.percentNum : 12,
          percentDen: v.mode === "percent" ? v.percentDen : 100,
          baseAmountMinor: v.mode === "percent" ? v.baseAmountMinor : 0,
        };
        break;
      case "imported":
        input = { ...common, mode: "imported" };
        break;
      case "none":
        input = { ...common, mode: "none" };
        break;
    }
    const r = await upsertEpfoContributionProfileAction(input);
    if (!r.ok) {
      toastError(r.error.message);
      return;
    }
    toastConfirmed("Contribution profile saved.");
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium">
        {labelForKind(kind)} — expected per month
      </p>
      <FormField id="prof-mode" label="Tracking mode">
        <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SelectTrigger id="prof-mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed amount</SelectItem>
            <SelectItem value="percent">Percentage of base</SelectItem>
            <SelectItem value="imported">From imported passbook</SelectItem>
            <SelectItem value="none">Don't track</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      {mode === "fixed" ? (
        <FormField id="prof-amount" label="Amount (per month)" error={(errors as Record<string, { message?: string }>).amountMinor?.message}>
          <Controller
            control={control}
            name={"amountMinor" as never}
            render={({ field }) => (
              <Input
                id="prof-amount"
                inputMode="decimal"
                placeholder="12000"
                value={amountField.display}
                onChange={(e) => amountField.onChange(e.target.value, field.onChange)}
              />
            )}
          />
        </FormField>
      ) : null}
      {mode === "percent" ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField id="prof-pct" label="Percent (e.g. 12 for 12%)">
            <Controller
              control={control}
              name={"percentNum" as never}
              defaultValue={12 as never}
              render={({ field }) => (
                <Input id="prof-pct" type="number" min={0} value={field.value ?? ""} onChange={(e) => field.onChange(Number(e.target.value))} />
              )}
            />
          </FormField>
          <FormField id="prof-base" label="Base amount (e.g. basic + DA)">
            <Controller
              control={control}
              name={"baseAmountMinor" as never}
              render={({ field }) => (
                <Input
                  id="prof-base"
                  inputMode="decimal"
                  placeholder="100000"
                  value={baseField.display}
                  onChange={(e) => baseField.onChange(e.target.value, field.onChange)}
                />
              )}
            />
          </FormField>
        </div>
      ) : null}
      <FormField id="prof-from" label="Effective from">
        <Input id="prof-from" type="date" {...register("effectiveFrom" as never)} />
      </FormField>
      <input type="hidden" {...register("percentDen" as never)} defaultValue={100} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

// Tiny clone of add-account-sheet's useMoneyField, kept local so EPFO
// stays self-contained and does not import a React hook from a sibling
// client component (which Next's bundler disallows).
function formatPeriodLabel(periodKey: string): string {
  const parts = periodKey.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// ============================================================
// This month summary
// ============================================================

type PeriodSummaryPayload = OverviewPayload["currentPeriod"]["summary"];

const STATUS_DISPLAY: Record<string, { label: string; className: string }> = {
  EXPECTED: { label: "Expected", className: "text-muted-foreground" },
  RECONCILIATION_PENDING: { label: "Pending", className: "text-amber-600 dark:text-amber-400" },
  MATCHED: { label: "Matched", className: "text-success" },
  MISMATCH: { label: "Mismatch", className: "text-destructive" },
};

function ThisMonthSummary({ summary, currency, masked }: { summary: PeriodSummaryPayload; currency: string; masked: boolean }) {
  const KINDS = [
    { key: "employee_epf" as const, label: "Employee EPF" },
    { key: "employer_epf" as const, label: "Employer EPF" },
    { key: "eps" as const, label: "EPS" },
  ];
  return (
    <div className="divide-y divide-border rounded-xl border bg-card">
      {KINDS.map(({ key, label }) => {
        const data = summary.byKind[key];
        if (!data) return null;
        const expected = DomainMoney.fromMinorUnits(BigInt(data.expectedMinor), currency);
        const actual = data.hasActual ? DomainMoney.fromMinorUnits(BigInt(data.actualMinor), currency) : null;
        const st = STATUS_DISPLAY[data.status] ?? STATUS_DISPLAY.EXPECTED!;
        return (
          <div key={key} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{label}</span>
              <span className={`text-xs font-medium ${st.className}`}>{st.label}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Expected: <Money value={expected} masked={masked} size="numeric" />
              </span>
              {actual != null ? (
                <span>
                  Recorded: <Money value={actual} masked={masked} size="numeric" />
                </span>
              ) : (
                <span className="italic">Not yet recorded</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Record contribution form
// ============================================================

function RecordContributionForm({
  accountId,
  employmentId,
  currency,
  onClose,
  onSaved,
}: {
  accountId: string;
  employmentId: string | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<RecordEpfoContributionInput>({
    resolver: zodResolver(recordEpfoContributionSchema),
    defaultValues: {
      accountId,
      employmentId,
      kind: "employee_epf",
      amountMinor: 0,
      occurredAt: new Date().toISOString(),
      description: "",
      externalReference: "",
    },
  });

  const amountField = useMoneyField("", currency);

  async function onSubmit(data: RecordEpfoContributionInput) {
    const result = await recordEpfoContributionAction({
      ...data,
      description: data.description?.trim() || null,
      externalReference: data.externalReference?.trim() || null,
    });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Contribution recorded.");
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3 p-4">
      <input type="hidden" {...register("accountId")} />
      <input type="hidden" {...register("employmentId")} />
      <FormField id="rec-kind" label="Type" error={errors.kind?.message}>
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="rec-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee_epf">Employee EPF</SelectItem>
                <SelectItem value="employer_epf">Employer EPF</SelectItem>
                <SelectItem value="eps">EPS</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <FormField id="rec-amount" label="Amount" error={(errors as Record<string, { message?: string }>).amountMinor?.message}>
        <Controller
          control={control}
          name="amountMinor"
          render={({ field }) => (
            <Input
              id="rec-amount"
              inputMode="decimal"
              placeholder="1800"
              value={amountField.display}
              onChange={(e) => amountField.onChange(e.target.value, field.onChange)}
            />
          )}
        />
      </FormField>
      <FormField id="rec-date" label="Date" error={errors.occurredAt?.message}>
        <Input
          id="rec-date"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          {...register("occurredAt", {
            setValueAs: (v: string) => (v ? new Date(v + "T00:00:00").toISOString() : v),
          })}
        />
      </FormField>
      <FormField id="rec-desc" label="Description (optional)" error={errors.description?.message}>
        <Input id="rec-desc" placeholder="Monthly EPF credit" {...register("description")} />
      </FormField>
      <FormField id="rec-ref" label="Reference number (optional)" error={errors.externalReference?.message}>
        <Input id="rec-ref" placeholder="EPFO transaction ref" {...register("externalReference")} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Record contribution"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

// ============================================================
// Correct balance form
// ============================================================

function CorrectBalanceForm({
  accountId,
  currentTotalMinor,
  currency,
  onClose,
  onSaved,
}: {
  accountId: string;
  currentTotalMinor: string;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [direction, setDirection] = useState<"add" | "reduce">("add");
  const [deltaMinorAbs, setDeltaMinorAbs] = useState(0);
  const amountField = useMoneyField("", currency);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CorrectEpfoBalanceInput>({
    resolver: zodResolver(correctEpfoBalanceSchema),
    defaultValues: {
      accountId,
      deltaMinor: 0,
      reason: "",
      occurredAt: new Date().toISOString(),
    },
  });

  const currentMinor = BigInt(currentTotalMinor);
  const signedDelta = direction === "add" ? deltaMinorAbs : -deltaMinorAbs;
  const newMinor = currentMinor + BigInt(signedDelta);
  const currentMoney = DomainMoney.fromMinorUnits(currentMinor, currency);
  const newMoney = DomainMoney.fromMinorUnits(newMinor, currency);

  function handleAmountChange(raw: string) {
    amountField.onChange(raw, (minor: number) => {
      setDeltaMinorAbs(minor);
      setValue("deltaMinor", direction === "add" ? minor : -minor);
    });
  }

  function handleDirectionChange(dir: "add" | "reduce") {
    setDirection(dir);
    setValue("deltaMinor", dir === "add" ? deltaMinorAbs : -deltaMinorAbs);
  }

  async function onSubmit(data: CorrectEpfoBalanceInput) {
    const result = await correctEpfoBalanceAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Balance corrected.");
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3 p-4">
      <input type="hidden" {...register("accountId")} />
      <div className="rounded-lg bg-muted/50 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Current balance</span>
          <Money value={currentMoney} masked={false} size="numeric" />
        </div>
        {deltaMinorAbs > 0 && (
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">After adjustment</span>
            <span className={newMinor >= 0n ? "" : "text-destructive"}>
              <Money value={newMoney} masked={false} size="numeric" />
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField id="corr-dir" label="Direction">
          <Select value={direction} onValueChange={(v) => handleDirectionChange(v as "add" | "reduce")}>
            <SelectTrigger id="corr-dir"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="add">Add to balance</SelectItem>
              <SelectItem value="reduce">Reduce balance</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="corr-amount" label="Amount">
          <Input
            id="corr-amount"
            inputMode="decimal"
            placeholder="500"
            value={amountField.display}
            onChange={(e) => handleAmountChange(e.target.value)}
          />
        </FormField>
      </div>
      <FormField id="corr-reason" label="Reason" error={errors.reason?.message}>
        <Textarea
          id="corr-reason"
          rows={2}
          placeholder="e.g. Passbook sync correction, ₹500 credit missed in import"
          {...register("reason")}
          aria-invalid={!!errors.reason}
          aria-describedby={errors.reason ? errorId("corr-reason") : undefined}
        />
      </FormField>
      <FormField id="corr-date" label="Date" error={errors.occurredAt?.message}>
        <Input
          id="corr-date"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          {...register("occurredAt", {
            setValueAs: (v: string) => (v ? new Date(v + "T00:00:00").toISOString() : v),
          })}
        />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting || deltaMinorAbs === 0}>
          {isSubmitting ? "Saving…" : "Apply correction"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function useMoneyField(initial = "", currency = "INR") {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
    setDisplay(normalized);
    if (normalized === "" || normalized === ".") {
      set(0);
      return;
    }
    const { minor } = parseMoneyInput(normalized, currency);
    set(minor);
  }
  return { display, onChange };
}
