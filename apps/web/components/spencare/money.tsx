import type { Money as DomainMoney } from "@spencare/domain-core";
import { cn } from "@/lib/utils";
import { formatMinorUnits } from "@/lib/currency-format";

/**
 * <Money> — the SOLE amount-rendering component in Spencare. Every financial
 * value in the product must pass through this component (design-system-
 * specification.md §2, §9). It consumes an already-validated domain Money
 * instance and owns: Indian digit grouping, currency symbol, tabular-numeric
 * presentation, Privacy Mode masking, and positive/negative visual
 * treatment. It performs NO calculation of its own — the amount it renders
 * is exactly what the domain layer already computed.
 */

export type MoneyTone = "neutral" | "positive" | "negative" | "auto";
export type MoneySize = "body" | "numeric" | "hero";

export interface MoneyProps {
  /** The domain-safe amount to render. */
  value: DomainMoney;
  /**
   * When true, renders a fixed-width mask ("₹***") instead of digits,
   * regardless of the amount's actual length -- per the confirmed-correct
   * pattern in design-tokens.md (a length-matching mask would leak digit-
   * count information; a fixed mask reveals nothing).
   */
  masked?: boolean;
  /**
   * "neutral": no color, no sign (category totals, generic amounts).
   * "positive": green + explicit "+" (income rows) -- caller-driven, since
   *   transactions.amount_minor is always stored positive in the DB;
   *   direction comes from `type`, not the value's mathematical sign.
   * "negative": red color, no forced "-" (expense rows; the surrounding
   *   context already implies direction) -- design-decisions.md DD-09.
   * "auto": derives tone from the value's actual mathematical sign, for
   *   genuinely signed figures like a Safe-to-Spend result that may be
   *   negative (api-architecture.md §8.4) -- never used for stored
   *   transaction amounts.
   */
  tone?: MoneyTone;
  /**
   * "body": default paragraph-level amount.
   * "numeric": standard list/row figure (type.numeric).
   * "hero": the Safe-to-Spend / primary-balance treatment (type.numeric.hero)
   *   -- must be visibly the largest financial figure on its screen, per
   *   information-architecture.md §4 and design-tokens.md §2's flagged gap.
   */
  size?: MoneySize;
  className?: string;
  /** Overrides the default aria-label; useful when a row already has surrounding context. */
  "aria-label"?: string;
}

const SIZE_CLASSES: Record<MoneySize, string> = {
  body: "text-sm",
  numeric: "text-base font-medium",
  hero: "text-4xl font-bold tracking-tight",
};

function resolveTone(tone: MoneyTone, isNegative: boolean): "neutral" | "positive" | "negative" {
  if (tone !== "auto") return tone;
  return isNegative ? "negative" : "positive";
}

const TONE_CLASSES: Record<"neutral" | "positive" | "negative", string> = {
  neutral: "text-foreground",
  positive: "text-success",
  negative: "text-destructive",
};

export function Money({
  value,
  masked = false,
  tone = "neutral",
  size = "numeric",
  className,
  "aria-label": ariaLabel,
}: MoneyProps) {
  const formatted = formatMinorUnits(value.amountMinorUnits, value.currencyCode);
  const resolvedTone = resolveTone(tone, formatted.isNegative);

  if (masked) {
    return (
      <span
        className={cn("tabular-nums", SIZE_CLASSES[size], className)}
        aria-label={ariaLabel ?? "Amount hidden — Privacy Mode is on"}
      >
        {formatted.symbol}***
      </span>
    );
  }

  // Sign prefix logic (design-decisions.md DD-09 + api-architecture.md §8.4):
  //  - tone="positive"            -> explicit "+" (income rows)
  //  - tone="negative"            -> color only, no "-" (row context implies direction)
  //  - tone="auto" and negative   -> explicit "-" (a standalone signed figure, e.g. a
  //                                  negative Safe to Spend, has no surrounding row
  //                                  context to imply direction and must never be
  //                                  silently hidden per api-architecture.md §8.4)
  //  - tone="neutral"             -> no sign, plain digits
  const isAutoNegative = tone === "auto" && formatted.isNegative;
  const signPrefix =
    resolvedTone === "positive" && !formatted.isNegative && !value.isZero()
      ? "+"
      : isAutoNegative
        ? "-"
        : "";
  const digits =
    formatted.decimalPart.length > 0
      ? `${formatted.symbol}${formatted.integerPart}.${formatted.decimalPart}`
      : `${formatted.symbol}${formatted.integerPart}`;
  const display = `${signPrefix}${digits}`;

  return (
    <span
      className={cn(
        "tabular-nums",
        SIZE_CLASSES[size],
        TONE_CLASSES[resolvedTone],
        className,
      )}
      aria-label={
        ariaLabel ??
        `${formatted.isNegative ? "negative " : ""}${formatted.symbol}${formatted.integerPart}${formatted.decimalPart.length > 0 ? ` point ${formatted.decimalPart}` : ""}`
      }
    >
      {display}
    </span>
  );
}
