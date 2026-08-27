import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BillPredictionRow } from "@spencare/domain-application";

/**
 * CF-D11 (visual-conflicts.md): a predicted (`open`/`overdue`) row must be
 * visually distinct from a matched/settled row WITHOUT relying on color
 * alone (accessibility-requirements.md's own general rule, applied here
 * explicitly per this phase's instruction). Each state pairs a distinct
 * icon with distinct text, not just a different badge color -- a reader
 * who can't perceive the color difference (or a screen reader, which
 * ignores color entirely) still gets "Due"/"Overdue"/"Paid" as the actual
 * signal, with the icon's `aria-hidden` decorative only.
 *
 * `skipped` is included for schema completeness (`bill_prediction_status`
 * has all four values) even though no command in this phase ever sets it
 * (api-architecture.md §13 / domain-architecture.md §8 name no `skipBill`
 * command) -- so this case is unreachable today, not dead code guarding
 * against a real path.
 */
function formatDueDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function BillStatusBadge({ status, expectedDate }: { status: BillPredictionRow["status"]; expectedDate: string }) {
  if (status === "matched") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Paid
      </Badge>
    );
  }
  if (status === "overdue") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="size-3" aria-hidden="true" />
        Overdue
      </Badge>
    );
  }
  if (status === "skipped") {
    return (
      <Badge variant="outline" className="gap-1">
        Skipped
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="size-3" aria-hidden="true" />
      Due {formatDueDate(expectedDate)}
    </Badge>
  );
}
