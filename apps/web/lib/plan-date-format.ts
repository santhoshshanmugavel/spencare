/**
 * Human-readable date formatting for Plan-related dates (`start_date`,
 * `end_date`, `expected_date`, transaction `occurred_at`). Mirrors the
 * existing convention in `goal-detail-dialog.tsx`
 * (`toLocaleDateString` with an explicit UTC anchor so a plain
 * `YYYY-MM-DD` string never shifts a day depending on the viewer's local
 * timezone) rather than inventing a new formatting system.
 */
export function formatPlanDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const datePart = iso.slice(0, 10);
  return new Date(`${datePart}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
