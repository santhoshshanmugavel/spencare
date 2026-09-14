import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import type { SafeToSpendState } from "@spencare/domain-application";
import { SafeToSpendHeroCard, FinancialLayersCard, type SafeToSpendPlain, type NetWorthPlain } from "./financial-overview-cards";

function safeToSpend(overrides: Partial<SafeToSpendPlain> = {}): SafeToSpendPlain {
  return {
    state: "balance_only" as SafeToSpendState,
    amountMinor: 500000,
    currency: "INR",
    ownedSpendableMinor: 500000,
    creditAvailableMinor: 0,
    goalReservedMinor: 0,
    cardPaymentReservedMinor: 0,
    upcomingBillsMinor: 0,
    ...overrides,
  };
}

const netWorth: NetWorthPlain = { netWorthMinor: 500000, totalAssetsMinor: 500000, totalLiabilitiesMinor: 0, currency: "INR" };

/**
 * This is the ONE component both Home and Cash Flow Overview render for
 * their financial-layers UI (Phase 29 Section 7/39: "does Home match Cash
 * Flow?" must be true by construction) -- tested once here rather than
 * duplicated per consumer.
 */
describe("<SafeToSpendHeroCard>", () => {
  it("labels balance_only as 'Available Balance', every other state as 'Safe to Spend'", () => {
    const { rerender } = render(<SafeToSpendHeroCard safeToSpend={safeToSpend({ state: "balance_only" })} masked={false} />);
    expect(screen.getByText("Available Balance")).toBeInTheDocument();

    rerender(<SafeToSpendHeroCard safeToSpend={safeToSpend({ state: "budget_and_goals" })} masked={false} />);
    expect(screen.getByText("Safe to Spend")).toBeInTheDocument();
  });

  it("shows an honest no_accounts prompt, never a fabricated ₹0", () => {
    render(<SafeToSpendHeroCard safeToSpend={safeToSpend({ state: "no_accounts", amountMinor: 0 })} masked={false} />);
    expect(screen.getByText(/add a bank or cash account/i)).toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("Phase 29: always shows an 'Owned money' breakdown line, never a 'Bank + Cash / Credit Available' composition implying credit is part of the total", () => {
    render(<SafeToSpendHeroCard safeToSpend={safeToSpend({ creditAvailableMinor: 4000000 })} masked={false} />);
    expect(screen.getByText(/Owned money/)).toBeInTheDocument();
    expect(screen.queryByText(/Credit Available/)).not.toBeInTheDocument();
  });

  it("shows 'Reserved for goals' / 'Upcoming bills' only when non-zero", () => {
    const { rerender } = render(<SafeToSpendHeroCard safeToSpend={safeToSpend({ goalReservedMinor: 100000 })} masked={false} />);
    expect(screen.getByText(/Reserved for goals/)).toBeInTheDocument();

    rerender(<SafeToSpendHeroCard safeToSpend={safeToSpend({ goalReservedMinor: 0 })} masked={false} />);
    expect(screen.queryByText(/Reserved for goals/)).not.toBeInTheDocument();
  });

  it("has no axe violations in either state", async () => {
    const { container, rerender } = render(<SafeToSpendHeroCard safeToSpend={safeToSpend()} masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
    rerender(<SafeToSpendHeroCard safeToSpend={safeToSpend({ state: "no_accounts" })} masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<FinancialLayersCard>", () => {
  it("shows Available Credit, Investments, and Net Worth as separate labeled figures", () => {
    render(<FinancialLayersCard creditAvailableMinor={4000000} investmentTotalMinor={30000000} netWorth={{ ...netWorth, netWorthMinor: 33500000 }} masked={false} />);
    expect(screen.getByText("Available Credit")).toBeInTheDocument();
    expect(screen.getByText(/Not included in Safe to Spend/)).toBeInTheDocument();
    expect(screen.getByText("Investments")).toBeInTheDocument();
    expect(screen.getByText(/In Net Worth, not Safe to Spend/)).toBeInTheDocument();
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("renders nothing when there is no credit, no investment, and no liability", () => {
    const { container } = render(<FinancialLayersCard creditAvailableMinor={0} investmentTotalMinor={0} netWorth={netWorth} masked={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still shows Net Worth when only a liability makes it non-trivial, even with zero credit/investment display figures", () => {
    render(<FinancialLayersCard creditAvailableMinor={0} investmentTotalMinor={0} netWorth={{ ...netWorth, totalLiabilitiesMinor: 500000, netWorthMinor: -500000 }} masked={false} />);
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<FinancialLayersCard creditAvailableMinor={4000000} investmentTotalMinor={30000000} netWorth={netWorth} masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
