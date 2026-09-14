import { Money as DomainMoney } from "@spencare/domain-core";
import type { SafeToSpendState } from "@spencare/domain-application";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/spencare/money";

/**
 * Shared Safe-to-Spend / Net Worth presentation, Phase 29 Section 7/39:
 * "Does Home match Cash Flow?" must always be yes -- extracted here so
 * Home and Cash Flow Overview render the exact same component with the
 * exact same data, rather than two hand-maintained copies that could
 * silently drift apart. Neither page owns this JSX any more.
 *
 * Plain-data shapes, not the real `Money`-bearing domain-core types --
 * `Money` instances carry a `toJSON` method that crashes the Next.js
 * Server->Client boundary (the real defect this convention originally
 * fixed, see cash-flow-overview.tsx/home-content.tsx git history); each
 * server page converts to this shape, this file reconstructs `Money`
 * client-side.
 */
export interface SafeToSpendPlain {
  state: SafeToSpendState;
  amountMinor: number;
  currency: string;
  /** Bank+Cash owned money -- as of Phase 29 this always equals `amountMinor` before goal/bill/budget reservations are subtracted. */
  ownedSpendableMinor: number;
  /** Credit Card available credit (limit minus used, never the limit) -- Phase 29 reversal: display-only, NEVER part of `amountMinor`. */
  creditAvailableMinor: number;
  /** Amount reserved out of ownedSpendableMinor for active goals. */
  goalReservedMinor: number;
  /** Amount reserved for credit-card payments (outstanding balances of cards with a configured payment source). Zero when none configured. */
  cardPaymentReservedMinor: number;
  /** Amount reserved out of ownedSpendableMinor for upcoming bills. */
  upcomingBillsMinor: number;
}

export interface NetWorthPlain {
  netWorthMinor: number;
  totalAssetsMinor: number;
  totalLiabilitiesMinor: number;
  currency: string;
}

/**
 * The Safe-to-Spend hero: the ONE headline spendability figure (Phase 29
 * Section 38: never visually equal to Total Balance / Available Credit /
 * Net Worth / Investment Value -- those are different concepts, never
 * this card). Below it, the "why" breakdown -- owned money and what was
 * reserved out of it. Credit is deliberately never one of these rows --
 * it has its own card (`<FinancialLayersCard>`), never presented as part
 * of this number's composition.
 */
export function SafeToSpendHeroCard({
  safeToSpend,
  masked,
  heroClassName = "text-3xl min-[375px]:text-4xl sm:text-5xl",
}: {
  safeToSpend: SafeToSpendPlain;
  masked: boolean;
  heroClassName?: string;
}) {
  if (safeToSpend.state === "no_accounts") {
    return (
      <Card>
        <CardContent className="space-y-1 py-6">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Safe to Spend</span>
          <p className="text-base text-muted-foreground">Add a bank or cash account to see how much you can safely spend.</p>
        </CardContent>
      </Card>
    );
  }

  // Show the breakdown whenever there's anything to explain: goal/bill reservations, OR credit
  // available (Phase 29: always anchor "Owned money" when credit exists, so the user never
  // mistakes Safe-to-Spend as including credit capacity).
  const hasBreakdown =
    safeToSpend.goalReservedMinor > 0 ||
    safeToSpend.cardPaymentReservedMinor > 0 ||
    safeToSpend.upcomingBillsMinor > 0 ||
    safeToSpend.creditAvailableMinor > 0;

  return (
    <Card className="overflow-hidden shadow-card">
      {/* Subtle tinted header strip */}
      <div className="bg-primary/5 px-5 pt-5 pb-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary/70">
          {safeToSpend.state === "balance_only" ? "Available Balance" : "Safe to Spend"}
        </span>
        <div className="mt-1">
          <Money
            value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.amountMinor), safeToSpend.currency as never)}
            masked={masked}
            size="hero"
            tone="auto"
            className={heroClassName}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          From your Bank + Cash after reservations
        </p>
      </div>

      {/* Breakdown — only when there's something to show */}
      {hasBreakdown ? (
        <CardContent className="px-5 py-3">
          <div className="divide-y divide-border/60">
            <div className="flex items-center justify-between py-2 text-xs">
              <span className="text-muted-foreground">Owned money</span>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.ownedSpendableMinor), safeToSpend.currency as never)}
                masked={masked}
                size="numeric"
                tone="neutral"
                className="text-xs tabular-nums"
              />
            </div>
            {safeToSpend.goalReservedMinor > 0 ? (
              <div className="flex items-center justify-between py-2 text-xs">
                <span className="text-muted-foreground">Reserved for goals</span>
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.goalReservedMinor), safeToSpend.currency as never)}
                  masked={masked}
                  size="numeric"
                  tone="neutral"
                  className="text-xs tabular-nums"
                />
              </div>
            ) : null}
            {safeToSpend.cardPaymentReservedMinor > 0 ? (
              <div className="flex items-center justify-between py-2 text-xs">
                <span className="text-muted-foreground">Reserved for card payments</span>
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.cardPaymentReservedMinor), safeToSpend.currency as never)}
                  masked={masked}
                  size="numeric"
                  tone="neutral"
                  className="text-xs tabular-nums"
                />
              </div>
            ) : null}
            {safeToSpend.upcomingBillsMinor > 0 ? (
              <div className="flex items-center justify-between py-2 text-xs">
                <span className="text-muted-foreground">Upcoming bills</span>
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.upcomingBillsMinor), safeToSpend.currency as never)}
                  masked={masked}
                  size="numeric"
                  tone="neutral"
                  className="text-xs tabular-nums"
                />
              </div>
            ) : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * Available Credit, Investments, and Net Worth -- three DIFFERENT
 * concepts from Safe-to-Spend, shown together but never summed into the
 * hero figure. Available Credit is borrowed capacity (never owned
 * money); Net Worth is a wealth concept; neither answers "how much can I
 * safely use right now." Renders nothing when all three are zero/absent.
 */
export function FinancialLayersCard({
  creditAvailableMinor,
  investmentTotalMinor,
  netWorth,
  masked,
}: {
  creditAvailableMinor: number;
  investmentTotalMinor: number;
  netWorth: NetWorthPlain;
  masked: boolean;
}) {
  if (creditAvailableMinor + investmentTotalMinor + netWorth.totalLiabilitiesMinor <= 0) return null;

  const items = [
    creditAvailableMinor > 0
      ? { label: "Available Credit", hint: "Not included in Safe to Spend", minor: creditAvailableMinor }
      : null,
    investmentTotalMinor > 0
      ? { label: "Investments", hint: "In Net Worth, not Safe to Spend", minor: investmentTotalMinor }
      : null,
    { label: "Net Worth", hint: "Assets minus credit owed", minor: netWorth.netWorthMinor },
  ].filter(Boolean) as { label: string; hint: string; minor: number }[];

  return (
    <Card className="shadow-card">
      <CardContent className="p-0">
        <div className="grid divide-x divide-border/60" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
          {items.map(({ label, hint, minor }) => (
            <div key={label} className="px-4 py-3 space-y-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
              <div>
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(minor), netWorth.currency as never)}
                  masked={masked}
                  size="body"
                  tone="neutral"
                  className="tabular-nums"
                />
              </div>
              <span className="text-[10px] text-muted-foreground/70">{hint}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
