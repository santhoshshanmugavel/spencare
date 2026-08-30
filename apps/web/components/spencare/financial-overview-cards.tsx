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
          <span className="text-sm font-medium text-muted-foreground">Safe to Spend</span>
          <p className="text-lg text-muted-foreground">Add a bank or cash account to see how much you can safely spend.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-1 py-5">
        <span className="text-sm font-medium text-muted-foreground">
          {safeToSpend.state === "balance_only" ? "Available Balance" : "Safe to Spend"}
        </span>
        <div>
          <Money
            value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.amountMinor), safeToSpend.currency as never)}
            masked={masked}
            size="hero"
            tone="auto"
            className={heroClassName}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          What you can safely use from your owned money (Bank + Cash) after goals, budget, and upcoming bills.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
          <span>
            Owned money{" "}
            <Money
              value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.ownedSpendableMinor), safeToSpend.currency as never)}
              masked={masked}
              size="numeric"
              tone="neutral"
              className="text-xs"
            />
          </span>
          {safeToSpend.goalReservedMinor > 0 ? (
            <span>
              Reserved for goals{" "}
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.goalReservedMinor), safeToSpend.currency as never)}
                masked={masked}
                size="numeric"
                tone="neutral"
                className="text-xs"
              />
            </span>
          ) : null}
          {safeToSpend.upcomingBillsMinor > 0 ? (
            <span>
              Upcoming bills{" "}
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.upcomingBillsMinor), safeToSpend.currency as never)}
                masked={masked}
                size="numeric"
                tone="neutral"
                className="text-xs"
              />
            </span>
          ) : null}
        </div>
      </CardContent>
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

  return (
    <Card>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-2 py-4">
        {creditAvailableMinor > 0 ? (
          <div>
            <span className="text-xs font-medium text-muted-foreground">Available Credit</span>
            <div>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(creditAvailableMinor), netWorth.currency as never)}
                masked={masked}
                size="body"
                tone="neutral"
              />
            </div>
            <span className="text-[11px] text-muted-foreground">Not included in Safe to Spend</span>
          </div>
        ) : null}
        {investmentTotalMinor > 0 ? (
          <div>
            <span className="text-xs font-medium text-muted-foreground">Investments</span>
            <div>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(investmentTotalMinor), netWorth.currency as never)}
                masked={masked}
                size="body"
                tone="neutral"
              />
            </div>
            <span className="text-[11px] text-muted-foreground">In Net Worth, not Safe to Spend</span>
          </div>
        ) : null}
        <div>
          <span className="text-xs font-medium text-muted-foreground">Net Worth</span>
          <div>
            <Money
              value={DomainMoney.fromMinorUnits(BigInt(netWorth.netWorthMinor), netWorth.currency as never)}
              masked={masked}
              size="body"
              tone="neutral"
            />
          </div>
          <span className="text-[11px] text-muted-foreground">Assets minus credit owed</span>
        </div>
      </CardContent>
    </Card>
  );
}
