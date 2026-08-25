"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ConsequentialActionPreview — the single, canonical UI for every
 * consequential financial mutation in Spencare
 * (/docs/design/confirmation-ui-specification.md). No feature may create
 * its own confirmation UI (Phase 4A instruction §4).
 *
 * This component is a pure state-machine renderer. It:
 *   - renders the server-provided ActionPreview payload
 *   - does NOT determine whether an action is financially valid
 *   - does NOT calculate Safe to Spend or any other domain figure
 *   - does NOT mutate data -- onConfirm/onCancel/onRetry/onUndo are the
 *     caller's hooks into the real commands (proposeCommand/confirmCommand/
 *     undoCommand per api-architecture.md §2-3, §11)
 *
 * Hard safety rule (confirmation-ui-specification.md §4, §9): the Confirm
 * button is NEVER auto-focused. Reaching it always requires a deliberate
 * tab/click/tap.
 */

export type ConsequentialActionState =
  | "proposed"
  | "confirming"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "error";

export interface ActionPreviewField {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface ActionPreviewEffect {
  label: string;
  before: string;
  after: string;
}

/**
 * The structured contract shared across Web, Spensa, and MCP
 * (confirmation-ui-specification.md §6) -- Spencare's server is the single
 * source of this content; every surface renders its own UI shell around
 * identical data.
 */
export interface ActionPreview {
  commandType: string;
  summary: string;
  fields: ActionPreviewField[];
  effect?: ActionPreviewEffect;
  undoable: boolean;
}

export interface ConsequentialActionPreviewProps {
  preview: ActionPreview;
  state: ConsequentialActionState;
  /** Required for `state="proposed"` -- drives the visible expiry countdown. */
  expiresAt?: Date | null;
  /** Required for `state="error"` -- the specific reason, per api-architecture.md §3's stale-state-rejection guarantee. */
  errorMessage?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onUndo?: () => void;
  className?: string;
}

const STATE_META: Record<
  ConsequentialActionState,
  { stripe: string; icon: React.ReactNode; label: string }
> = {
  proposed: {
    stripe: "bg-warning",
    icon: <Clock className="size-4" aria-hidden="true" />,
    label: "Proposed",
  },
  confirming: {
    stripe: "bg-warning",
    icon: <Loader2 className="size-4 animate-spin" aria-hidden="true" />,
    label: "Confirming…",
  },
  confirmed: {
    stripe: "bg-success",
    icon: <CheckCircle2 className="size-4" aria-hidden="true" />,
    label: "Confirmed",
  },
  cancelled: {
    stripe: "bg-muted-foreground/40",
    icon: <XCircle className="size-4" aria-hidden="true" />,
    label: "Cancelled",
  },
  expired: {
    stripe: "bg-muted-foreground/40",
    icon: <Clock className="size-4" aria-hidden="true" />,
    label: "Expired",
  },
  error: {
    stripe: "bg-destructive",
    icon: <AlertTriangle className="size-4" aria-hidden="true" />,
    label: "Couldn't complete",
  },
};

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useCountdown(expiresAt: Date | null | undefined, active: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, expiresAt]);

  if (!active || !expiresAt) return null;
  return formatCountdown(expiresAt.getTime() - now);
}

export function ConsequentialActionPreview({
  preview,
  state,
  expiresAt,
  errorMessage,
  onConfirm,
  onCancel,
  onRetry,
  onUndo,
  className,
}: ConsequentialActionPreviewProps) {
  const meta = STATE_META[state];
  const countdown = useCountdown(expiresAt, state === "proposed");
  const liveRegionRef = useRef<HTMLDivElement>(null);

  // aria-live announcement on every state transition
  // (confirmation-ui-specification.md §9 / accessibility-requirements.md §10).
  const announcement = useMemo(() => {
    switch (state) {
      case "proposed":
        return `Proposed action: ${preview.summary}`;
      case "confirming":
        return "Confirming your action.";
      case "confirmed":
        return `Confirmed: ${preview.summary}`;
      case "cancelled":
        return "Action cancelled. Nothing was changed.";
      case "expired":
        return "This proposal expired.";
      case "error":
        return `This couldn't be completed. ${errorMessage ?? ""}`;
      default:
        return "";
    }
  }, [state, preview.summary, errorMessage]);

  return (
    <div
      role="group"
      aria-label={`${meta.label}: ${preview.summary}`}
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-card pl-4",
        className,
      )}
      data-state={state}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1", meta.stripe)} aria-hidden="true" />

      {/* Visually-present but screen-reader-redundant header icon; the live
          region below carries the actual announcement text. */}
      <div className="flex items-center gap-2 px-4 pt-3 text-xs font-medium text-muted-foreground">
        {meta.icon}
        <span>{meta.label}</span>
        {state === "proposed" && countdown ? (
          <span aria-hidden="true">· Expires in {countdown}</span>
        ) : null}
      </div>

      <div className="px-4 pb-4 pt-1">
        <p className="text-sm font-semibold text-foreground">{preview.summary}</p>

        {state === "cancelled" ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing was changed.</p>
        ) : null}
        {state === "expired" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            This proposal expired before it was confirmed.
          </p>
        ) : null}
        {state === "error" && errorMessage ? (
          <p className="mt-1 text-sm text-destructive">{errorMessage}</p>
        ) : null}

        {state !== "cancelled" && state !== "expired" ? (
          <dl className="mt-3 space-y-1">
            {preview.fields.map((field) => (
              <div key={field.label} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd
                  className={cn(
                    "tabular-nums text-right",
                    field.emphasis ? "font-semibold text-foreground" : "text-foreground",
                  )}
                >
                  {field.value}
                </dd>
              </div>
            ))}
            {preview.effect ? (
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-muted-foreground">{preview.effect.label}</dt>
                <dd className="tabular-nums text-right text-foreground">
                  {preview.effect.before} → {preview.effect.after}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {state === "proposed" ? (
            <>
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              {/* No autoFocus here, ever -- confirmation-ui-specification.md §9. */}
              <Button variant="default" size="sm" onClick={onConfirm}>
                Confirm
              </Button>
            </>
          ) : null}

          {state === "confirming" ? (
            <>
              <Button variant="outline" size="sm" disabled>
                Cancel
              </Button>
              <Button variant="default" size="sm" disabled>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Confirm
              </Button>
            </>
          ) : null}

          {state === "confirmed" && preview.undoable ? (
            <Button variant="ghost" size="sm" onClick={onUndo}>
              Undo
            </Button>
          ) : null}

          {state === "expired" ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Ask again
            </Button>
          ) : null}

          {state === "error" ? (
            <>
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div ref={liveRegionRef} aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>
    </div>
  );
}
