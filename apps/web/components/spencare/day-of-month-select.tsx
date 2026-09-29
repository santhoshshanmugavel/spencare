"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Sentinel value for "last day of the month" -- same 1-32 convention used
 * throughout Spencare for recurring day-of-month fields (commitments'
 * payment_day_rule/saving_day_rule, credit card statement_close_day/
 * payment_due_day). 32 is never a literal day; it means "whatever day the
 * month actually ends on."
 */
export const DAY_OF_MONTH_LAST = 32;

export function dayOfMonthLabel(n: number): string {
  if (n === DAY_OF_MONTH_LAST) return "Last day of month";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const DAY_OF_MONTH_OPTIONS: { value: number; label: string }[] = [
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: dayOfMonthLabel(i + 1) })),
  { value: DAY_OF_MONTH_LAST, label: "Last day of month" },
];

/**
 * A recurring day-of-month picker (1st..31st, or "Last day of month"),
 * used for credit card billing days. Matches the existing Select-based
 * pattern already established for commitment payment days
 * (cash-flow/upcoming/commitment-sheet.tsx's DAY_RULE_OPTIONS) so both
 * concepts read as the same design language -- extracted here rather than
 * duplicated a third time.
 */
export function DayOfMonthSelect({
  id,
  value,
  onChange,
  placeholder = "Choose a day",
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
}) {
  return (
    <Select
      value={value != null ? String(value) : ""}
      onValueChange={(v) => onChange(v ? parseInt(v, 10) : null)}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {DAY_OF_MONTH_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={String(opt.value)}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
