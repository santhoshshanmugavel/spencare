/**
 * Pure formatting helpers for the <Money> UI component. No React here —
 * kept separate so the digit-grouping/symbol logic is independently
 * testable without rendering.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  KWD: "KD",
  BHD: "BD",
};

/** Number of fractional (minor-unit) digits per currency. */
const CURRENCY_FRACTION_DIGITS: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
  BHD: 3,
};

export function currencyFractionDigits(currencyCode: string): number {
  return CURRENCY_FRACTION_DIGITS[currencyCode] ?? 2;
}

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
  const fractionDigits = currencyFractionDigits(currencyCode);
  const factor = BigInt(10 ** fractionDigits);
  const major = abs / factor;
  const minor = abs % factor;
  return {
    symbol: currencySymbol(currencyCode),
    integerPart: groupIndianDigits(major.toString()),
    decimalPart: fractionDigits > 0 ? minor.toString().padStart(fractionDigits, "0") : "",
    isNegative,
  };
}
