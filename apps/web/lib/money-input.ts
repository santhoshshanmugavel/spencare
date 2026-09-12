import { currencyFractionDigits } from "./currency-format";

/**
 * Parses a user-entered money string into integer minor units.
 * Accepts decimals, currency symbols, and comma separators.
 * Never uses floating-point arithmetic for the conversion.
 * Returns { minor } on success, { minor: 0, error } on invalid input.
 */
export function parseMoneyInput(
  raw: string,
  currency: string,
): { minor: number; error?: string } {
  const fractionDigits = currencyFractionDigits(currency);
  const cleaned = raw.replace(/[₹$€£¥]/g, "").replace(/,/g, "").trim();

  if (cleaned === "" || cleaned === ".") return { minor: 0 };
  if (!/^\d*\.?\d*$/.test(cleaned)) return { minor: 0, error: "Invalid amount." };

  const dotIndex = cleaned.indexOf(".");
  const intPart = dotIndex === -1 ? cleaned : cleaned.slice(0, dotIndex);
  const decPart = dotIndex === -1 ? "" : cleaned.slice(dotIndex + 1);

  if (decPart.length > fractionDigits) {
    return {
      minor: 0,
      error: `${currency} amounts support at most ${fractionDigits} decimal place${fractionDigits === 1 ? "" : "s"}.`,
    };
  }

  const paddedDec = decPart.padEnd(fractionDigits, "0");
  const combined = (intPart || "0") + paddedDec;
  const minor = Number(combined);
  if (!Number.isFinite(minor)) return { minor: 0, error: "Invalid amount." };
  return { minor };
}

/**
 * Converts stored integer minor units back to a display string for pre-filling
 * an edit form's money input. Trailing fractional zeros are omitted.
 * e.g., 7_484_087 (INR) → "74840.87", 500_000 (INR) → "5000"
 */
export function minorUnitsToDisplay(minor: number, currency: string): string {
  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === 0) return String(minor);
  const factor = 10 ** fractionDigits;
  const intPart = Math.trunc(minor / factor);
  const decPart = Math.abs(minor % factor);
  if (decPart === 0) return String(intPart);
  return `${intPart}.${String(decPart).padStart(fractionDigits, "0")}`;
}
