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
   * Debug-only string representation — NOT for display. No currency symbol,
   * no digit grouping. UI formatting is exclusively the UI-layer <Money>
   * component's responsibility.
   */
  toString(): string {
    return `${this.minorUnits.toString()} ${this.currency}`;
  }
}
