"use client";

import { useState, useTransition } from "react";
import type { AnomalyReport, AnomalyFinding, AnomalySeverity } from "@spencare/domain-core";
import { fetchAnomalyReport, explainAnomaly } from "./actions";
import type { AnomalyQuery } from "@spencare/domain-application";

interface Props {
  initialReport: AnomalyReport | null;
  initialError: string | null;
  currency: string;
  masked: boolean;
  currentPeriod: { start: string; end: string };
  baselineMonths: number;
}

function severityBadgeClass(severity: AnomalySeverity): string {
  if (severity === "high") return "bg-destructive/10 text-destructive border-destructive/20";
  if (severity === "medium") return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
  return "bg-muted text-muted-foreground border-border";
}

function typeLabel(type: AnomalyFinding["type"]): string {
  if (type === "large_transaction") return "Large Transaction";
  if (type === "category_spike") return "Category Spike";
  if (type === "merchant_spike") return "Merchant Spike";
  return "Duplicate Candidate";
}

function formatMinor(value: number, currency: string, masked: boolean): string {
  if (masked) return "●●●";
  return `${currency} ${Math.round(value / 100).toLocaleString()}`;
}

interface FindingCardProps {
  finding: AnomalyFinding;
  currency: string;
  masked: boolean;
  query: AnomalyQuery;
}

function FindingCard({ finding, currency, masked, query }: FindingCardProps) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  function handleExplain() {
    startTransition(async () => {
      const result = await explainAnomaly(query, finding.id);
      setExplanation(result.explanation);
      setExplainError(result.error);
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${severityBadgeClass(finding.severity)}`}
            >
              {finding.severity.toUpperCase()}
            </span>
            <span className="text-xs text-muted-foreground">{typeLabel(finding.type)}</span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-foreground truncate">{finding.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{finding.description}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold tabular-nums">
            {formatMinor(finding.observedValueMinor, currency, masked)}
          </div>
          {finding.baselineValueMinor !== null && (
            <div className="text-xs text-muted-foreground tabular-nums">
              avg {formatMinor(finding.baselineValueMinor, currency, masked)}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? "Hide steps ↑" : "Investigation steps ↓"}
        </button>
        <button
          type="button"
          onClick={handleExplain}
          disabled={isPending}
          className="ml-auto text-xs font-medium text-primary hover:underline disabled:opacity-50"
        >
          {isPending ? "Explaining…" : "Explain with AI"}
        </button>
      </div>

      {expanded && (
        <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground pl-1">
          {finding.investigationSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}

      {finding.limitations.length > 0 && expanded && (
        <div className="text-xs text-muted-foreground border-t border-border pt-2">
          {finding.limitations.map((l, i) => (
            <p key={i}>Note: {l}</p>
          ))}
        </div>
      )}

      {(explanation || explainError) && (
        <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
          {explanation && <p className="text-foreground">{explanation}</p>}
          {explainError && <p className="text-destructive text-xs">{explainError}</p>}
        </div>
      )}
    </div>
  );
}

export function AnomaliesView({
  initialReport,
  initialError,
  currency,
  masked,
  currentPeriod,
  baselineMonths,
}: Props) {
  const [report, setReport] = useState<AnomalyReport | null>(initialReport);
  const [error, setError] = useState<string | null>(initialError);
  const [isLoading, startTransition] = useTransition();

  const query: AnomalyQuery = { currentPeriod, currency, baselineMonths };

  function handleRefresh() {
    startTransition(async () => {
      const result = await fetchAnomalyReport(query);
      setReport(result.data);
      setError(result.error);
    });
  }

  const highFindings = report?.findings.filter((f) => f.severity === "high") ?? [];
  const mediumFindings = report?.findings.filter((f) => f.severity === "medium") ?? [];
  const lowFindings = report?.findings.filter((f) => f.severity === "low") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Anomalies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Patterns in {currentPeriod.start.slice(0, 7)} that may warrant a closer look.
            Baseline: {baselineMonths} months prior.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="shrink-0 text-xs text-primary hover:underline disabled:opacity-50"
        >
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!error && !report && !isLoading && (
        <div className="py-12 text-center text-muted-foreground text-sm">No data.</div>
      )}

      {report && !error && (
        <>
          {/* Summary bar */}
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-destructive" />
              <span className="text-muted-foreground">{highFindings.length} high</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">{mediumFindings.length} medium</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              <span className="text-muted-foreground">{lowFindings.length} low</span>
            </div>
            <span className="ml-auto text-muted-foreground">
              {report.currentPeriodTransactionCount} transactions analysed
            </span>
          </div>

          {/* Empty state */}
          {report.findings.length === 0 && (
            <div className="py-12 text-center space-y-2">
              <p className="text-base font-medium text-foreground">No anomalies detected</p>
              <p className="text-sm text-muted-foreground">
                Spending patterns in this period are within normal range.
              </p>
            </div>
          )}

          {/* Findings */}
          {report.findings.length > 0 && (
            <div className="space-y-3">
              {report.findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  currency={currency}
                  masked={masked}
                  query={query}
                />
              ))}
            </div>
          )}

          {/* Insufficient history notice */}
          {report.insufficientHistory && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              {report.limitations[0]}
            </div>
          )}

          {/* General limitations */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground transition-colors">
              About this analysis
            </summary>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              {report.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
