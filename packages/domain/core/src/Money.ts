/**
 * Money — the domain-safe integer-minor-unit value object.
 *
 * Governed by ADR-0002 (money is always integer minor units, never floating
 * point) and api-architecture.md §6 (financial invariants). This class owns:
 *   - integer minor-unit representation (bigint, never number/float)
 *   - arithmetic (add/subtract/negate/min/max/sum)
 *   - comparison
 *   - validation
 *   - zero/positive/negative handling
 *   - serialization boundaries (to/from a JSON-safe shape)
 *
 * It deliberately owns NONE of: currency-symbol rendering, digit grouping,
 * tabular-number CSS, Privacy Mode masking, or any other display concern —
 * those belong exclusively to the UI-layer <Money> component in
 * packages/ui, which consumes this class's already-validated amount. See
 * design-system-specification.md §2 and design-decisions.md (Phase 4A money
 * architecture split).
 *
 * This module has zero dependency on React, Supabase, or any AI SDK —
 * enforced by the architecture-conformance rule "domain-core-is-pure" in
 * .dependency-cruiser.cjs.
 */

/** ISO 4217 three-letter currency code, e.g. "INR". */
export type CurrencyCode = string;

const ISO_4217_PATTERN = /^[A-Z]{3}$/;

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: cannot operate on ${a} and ${b} together`);
    this.name = "CurrencyMismatchError";
  }
}

export interface MoneyJSON {
  amountMinorUnits: string;
  currency: CurrencyCode;
}

function assertValidCurrency(currency: string): void {
  if (!ISO_4217_PATTERN.test(currency)) {
    throw new InvalidMoneyError(
      `Invalid currency code "${currency}" — must be a 3-letter uppercase ISO 4217 code`,
    );
  }
}

export class Money {
  private readonly minorUnits: bigint;
  private readonly currency: CurrencyCode;

  private constructor(minorUnits: bigint, currency: CurrencyCode) {
    this.minorUnits = minorUnits;
    this.currency = currency;
  }

  /** Construct from an already-integer bigint amount in minor units. */
  static fromMinorUnits(minorUnits: bigint, currency: CurrencyCode): Money {
    assertValidCurrency(currency);
    return new Money(minorUnits, currency);
  }

  /**
   * Construct from a JS number. Rejects any non-integer value (e.g. 499.5)
   * — this is the primary guard against floating-point amounts entering the
   * domain layer at all. Prefer fromMinorUnits with a real bigint wherever
   * possible (e.g. values read directly from Postgres bigint columns).
   */
  static fromNumber(minorUnits: number, currency: CurrencyCode): Money {
    if (!Number.isInteger(minorUnits)) {
      throw new InvalidMoneyError(
        `Money amounts must be integer minor units — received non-integer ${minorUnits}`,
      );
    }
    if (!Number.isSafeInteger(minorUnits)) {
      throw new InvalidMoneyError(
        `Amount ${minorUnits} exceeds Number.MAX_SAFE_INTEGER — pass a bigint via fromMinorUnits instead`,
      );
    }
    assertValidCurrency(currency);
    return new Money(BigInt(minorUnits), currency);
  }

  /** Parse a decimal-string bigint (as returned by most Postgres drivers for `bigint` columns). */
  static parse(minorUnitsString: string, currency: CurrencyCode): Money {
    if (!/^-?\d+$/.test(minorUnitsString)) {
      throw new InvalidMoneyError(`Invalid integer string "${minorUnitsString}"`);
    }
    assertValidCurrency(currency);
    return new Money(BigInt(minorUnitsString), currency);
  }

  static zero(currency: CurrencyCode): Money {
    assertValidCurrency(currency);
    return new Money(0n, currency);
  }

  static fromJSON(json: MoneyJSON): Money {
    return Money.parse(json.amountMinorUnits, json.currency);
  }

  toJSON(): MoneyJSON {
    return { amountMinorUnits: this.minorUnits.toString(), currency: this.currency };
  }

  get amountMinorUnits(): bigint {
    return this.minorUnits;
  }

  get currencyCode(): CurrencyCode {
    return this.currency;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  negate(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  abs(): Money {
    return this.minorUnits < 0n ? this.negate() : this;
  }

  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  lessThan(other: Money): boolean {
    return this.compareTo(other) < 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compareTo(other) <= 0;
  }

  greaterThan(other: Money): boolean {
    return this.compareTo(other) > 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compareTo(other) >= 0;
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isNonNegative(): boolean {
    return this.minorUnits >= 0n;
  }

  /**
   * Throws if this amount is not strictly positive. Used at write
   * boundaries that require a positive amount (e.g. transactions.amount_minor
   * per database-architecture.md's `amount_minor > 0` check constraint) —
   * this is a call-site assertion, not a blanket restriction baked into
   * Money itself, since Safe-to-Spend and other derived values are
   * explicitly allowed to be negative (api-architecture.md §8.4).
   */
  assertPositive(context?: string): void {
    if (!this.isPositive()) {
      throw new InvalidMoneyError(
        `Expected a positive amount${context ? ` for ${context}` : ""}, got ${this.minorUnits}`,
      );
    }
  }

  static min(a: Money, b: Money): Money {
    a.assertSameCurrency(b);
    return a.lessThanOrEqual(b) ? a : b;
  }

  static max(a: Money, b: Money): Money {
    a.assertSameCurrency(b);
    return a.greaterThanOrEqual(b) ? a : b;
  }

  /**
   * Sums a list of same-currency Money values. Empty list returns zero.
   * Used directly by the Safe-to-Spend engine (api-architecture.md §8.3)
   * to compute `availableBalance = sum(ctx.cashBalances)`.
   */
  static sum(currency: CurrencyCode, monies: readonly Money[]): Money {
    return monies.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  /**
   * Exact rational multiplication: `this * (num / den)` with BANKER'S
   * ROUNDING on the final minor-unit result. Pure bigint arithmetic
   * throughout -- never crosses into IEEE-754, so results are deterministic
   * regardless of amount magnitude.
   *
   * Introduced in Phase 2 for EPFO contribution profiles that configure
   * percentages (e.g. "12% of basic + DA"): the Phase 2 audit flagged
   * that `Money` had no multiplication helper and that every existing
   * financial path was integer-additive only (sum/subtract). This is the
   * ONLY sanctioned way to compute a percentage of a Money amount; call
   * sites must NOT do `amount * 0.12` or `Number(minor) * pct` -- that
   * would reintroduce the exact float-arithmetic hazard ADR-0002 bans.
   *
   * ROUNDING: banker's rounding (round-half-to-even), the IEEE-754
   * default and the convention used by most Indian financial
   * calculations when a decimal rule is not specified in the source
   * document. For a 12.5-paise result we round to the nearest even
   * paise (12 -> 12, 13 -> 12, 125 -> 12 or 12 depending on prior half,
   * matching Decimal.ROUND_HALF_EVEN). This is tested exhaustively.
   *
   * ERRORS:
   *   - throws InvalidMoneyError if den is zero
   *   - throws InvalidMoneyError if either num or den is non-integer
   *     (bigints inherently are, but the TS compiler can't stop a caller
   *      from passing `BigInt(0.5)` which becomes 0n and silently
   *      produces zero -- that is a bug the caller introduced, not one
   *      Money must mask).
   *
   * SIGNS: standard: (positive * negative) and (negative * positive)
   * both yield a negative result; (negative * negative) yields positive.
   */
  multiplyRational(num: bigint, den: bigint): Money {
    if (typeof num !== "bigint" || typeof den !== "bigint") {
      throw new InvalidMoneyError(
        "multiplyRational(num, den) requires both arguments to be bigints",
      );
    }
    if (den === 0n) {
      throw new InvalidMoneyError("multiplyRational: denominator cannot be zero");
    }
    // Normalize so the denominator is always positive; move any sign to
    // the numerator. Keeps the half-tie branch below sign-agnostic.
    let n = num;
    let d = den;
    if (d < 0n) {
      n = -n;
      d = -d;
    }

    const product = this.minorUnits * n;
    // Exact-divisible fast path.
    if (product % d === 0n) {
      return new Money(product / d, this.currency);
    }

    // Banker's rounding: look at the remainder scaled by 2 against the
    // denominator -- less -> round down (toward -infinity in the
    // product's sign-adjusted direction, which is toward zero for
    // standard round-down-to-nearest), greater -> round up, equal
    // (tie) -> round to even.
    // We operate on absolute values for the half-check and reapply the
    // sign at the end so negative results tie-break the same way.
    const absProduct = product < 0n ? -product : product;
    const quotient = absProduct / d;
    const remainder = absProduct - quotient * d;
    const twiceRemainder = remainder * 2n;

    let rounded: bigint;
    if (twiceRemainder < d) {
      rounded = quotient; // round down
    } else if (twiceRemainder > d) {
      rounded = quotient + 1n; // round up
    } else {
      // Exact half: round to even (banker's).
      rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
    }

    const signed = product < 0n ? -rounded : rounded;
    return new Money(signed, this.currency);
  }

  /**
   * Debug-only string representation — NOT for display. No currency symbol,
   * no digit grouping. UI formatting is exclusively the UI-layer <Money>
   * component's responsibility.
   */
  toString(): string {
    return `${this.minorUnits.toString()} ${this.currency}`;
  }
}
