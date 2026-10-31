"use client";

import { useState } from "react";
import type { CaptureCandidateRow } from "@spencare/domain-application";
import type { AccountRow, CategoryRow } from "@spencare/domain-application";
import { Smartphone } from "lucide-react";
import { formatMinorUnits } from "@/lib/currency-format";

function fmtAmount(minor: number, currency: string): string {
  const f = formatMinorUnits(BigInt(minor), currency);
  return `${f.symbol}${f.integerPart}.${f.decimalPart}`;
}
import {
  dismissCaptureCandidateAction,
} from "./actions";
import { ConfirmCaptureSheet } from "./confirm-capture-sheet";

interface Props {
  candidates: CaptureCandidateRow[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  masked: boolean;
}

export function CaptureCandidatesSection({ candidates, accounts, categories, masked }: Props) {
  const [selected, setSelected] = useState<CaptureCandidateRow | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = candidates.filter((c) => !dismissed.has(c.id));
  if (visible.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Captured transactions pending review">
      <div className="flex items-center gap-2 mb-3">
        <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium text-muted-foreground">
          {visible.length === 1 ? "1 transaction captured" : `${visible.length} transactions captured`}
        </h2>
      </div>
      <ul className="space-y-2">
        {visible.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            masked={masked}
            onReview={() => setSelected(c)}
            onDismissed={() => setDismissed((prev) => new Set([...prev, c.id]))}
          />
        ))}
      </ul>
      {selected && (
        <ConfirmCaptureSheet
          candidate={selected}
          accounts={accounts}
          categories={categories}
          masked={masked}
          onClose={() => setSelected(null)}
          onConfirmed={() => {
            setDismissed((prev) => new Set([...prev, selected.id]));
            setSelected(null);
          }}
          onDismissed={() => {
            setDismissed((prev) => new Set([...prev, selected.id]));
            setSelected(null);
          }}
        />
      )}
    </section>
  );
}

function CandidateCard({
  candidate,
  masked,
  onReview,
  onDismissed,
}: {
  candidate: CaptureCandidateRow;
  masked: boolean;
  onReview: () => void;
  onDismissed: () => void;
}) {
  const [dismissing, setDismissing] = useState(false);

  const amountDisplay = masked
    ? "••••"
    : candidate.amount_minor != null
    ? fmtAmount(candidate.amount_minor, candidate.currency ?? "INR")
    : "Unknown amount";

  const direction = candidate.direction === "income" ? "Income" : "Expense";
  const merchant = candidate.merchant ?? "Unknown merchant";

  async function handleDismiss() {
    setDismissing(true);
    await dismissCaptureCandidateAction(candidate.id);
    onDismissed();
  }

  return (
    <li className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 gap-3">
      <button
        className="flex-1 text-left min-w-0"
        onClick={onReview}
        type="button"
        aria-label={`Review captured ${direction.toLowerCase()}: ${amountDisplay} at ${merchant}`}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium truncate">{merchant}</span>
          <span className="text-xs text-muted-foreground shrink-0">{direction}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {amountDisplay}{candidate.occurred_at ? ` · ${candidate.occurred_at}` : ""}
        </div>
      </button>
      <div className="flex gap-2 shrink-0">
        <button
          className="text-xs text-primary font-medium hover:underline focus:outline-none"
          onClick={onReview}
          type="button"
        >
          Review
        </button>
        <button
          className="text-xs text-muted-foreground hover:text-destructive focus:outline-none"
          onClick={handleDismiss}
          disabled={dismissing}
          type="button"
          aria-label="Dismiss this captured transaction"
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}
