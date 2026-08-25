/**
 * Pure formatting helpers for the <Money> UI component. No React here —
 * kept separate so the digit-grouping/symbol logic is independently
 * testable without rendering.
 *
 * Scoping note: assumes 2 minor-unit decimal places (matches INR, the only
 * currency evidenced anywhere in the source screens) — zero-decimal
 * currencies (e.g. JPY) are not handled and would need this revisited. Not
 * invented beyond what the product currently needs.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function currencySymbol(currencyCode: string): string {
  return CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;
}

/**
 * Indian digit grouping (lakh/crore): last 3 digits form one group, then
 * groups of 2 to the left. E.g. 1234567 -> "12,34,567".
 */
export function groupIndianDigits(integerDigits: string): string {
  if (integerDigits.length <= 3) return integerDigits;
  const lastThree = integerDigits.slice(-3);
  const rest = integerDigits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${grouped},${lastThree}`;
}

export interface FormattedMoney {
  symbol: string;
  integerPart: string; // already comma-grouped
  decimalPart: string; // two digits, no leading dot
  isNegative: boolean;
}

/** Formats an absolute-value-aware breakdown; the caller decides sign presentation. */
export function formatMinorUnits(amountMinorUnits: bigint, currencyCode: string): FormattedMoney {
  const isNegative = amountMinorUnits < 0n;
  const abs = isNegative ? -amountMinorUnits : amountMinorUnits;
  const major = abs / 100n;
  const minor = abs % 100n;
  return {
    symbol: currencySymbol(currencyCode),
    integerPart: groupIndianDigits(major.toString()),
    decimalPart: minor.toString().padStart(2, "0"),
    isNegative,
  };
}
