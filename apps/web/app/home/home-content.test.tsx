import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import type { SafeToSpendState } from "@spencare/domain-application";
import { HomeContent, type SafeToSpendPlain, type NetWorthPlain } from "./home-content";

function safeToSpend(overrides: Partial<SafeToSpendPlain> = {}): SafeToSpendPlain {
  return {
    state: "balance_only" as SafeToSpendState,
    amountMinor: 500000,
    currency: "INR",
    ownedSpendableMinor: 500000,
    creditAvailableMinor: 0,
    goalReservedMinor: 0,
    upcomingBillsMinor: 0,
    ...overrides,
  };
}

const netWorth: NetWorthPlain = { netWorthMinor: 500000, totalAssetsMinor: 500000, totalLiabilitiesMinor: 0, currency: "INR" };

const baseProps = {
  displayName: "Asha",
  masked: false,
  hasAccounts: true,
  hasBudget: true,
  hasGoals: true,
  safeToSpend: safeToSpend(),
  netWorth,
  investmentTotalMinor: 0,
};

describe("<HomeContent> — Safe-to-Spend header (DD-01)", () => {
  it("labels a plain balance_only state 'Available Balance', never 'Safe to Spend'", () => {
    render(<HomeContent {...baseProps} safeToSpend={safeToSpend({ state: "balance_only" })} />);
    expect(screen.getByText("Available Balance")).toBeInTheDocument();
    // tone="auto" on a non-negative figure renders a "+" prefix, matching
    // the identical `cash-flow-overview.tsx` header treatment (Phase 13).
    expect(screen.getByText("+₹5,000.00")).toBeInTheDocument();
  });

  it.each([
    ["budget_only", "Safe to Spend"],
    ["goals_only", "Safe to Spend"],
    ["budget_and_goals", "Safe to Spend"],
  ] as const)("labels state %s as 'Safe to Spend'", (state, label) => {
    render(<HomeContent {...baseProps} safeToSpend={safeToSpend({ state })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("never fabricates a value for the no_accounts state -- shows an honest prompt instead", () => {
    render(<HomeContent {...baseProps} hasAccounts={false} safeToSpend={safeToSpend({ state: "no_accounts", amountMinor: 0 })} />);
    expect(screen.getByText(/add a bank or cash account to see how much you can safely spend/i)).toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("masks the header figure (and its breakdown) when Privacy Mode is on", () => {
    render(<HomeContent {...baseProps} masked safeToSpend={safeToSpend({ amountMinor: 123456, ownedSpendableMinor: 123456 })} />);
    expect(screen.queryByText("₹1,234.56")).not.toBeInTheDocument();
    expect(screen.getAllByText("₹***").length).toBeGreaterThan(0);
  });
});

describe("<HomeContent> — Phase 29: Home matches Cash Flow's financial layers", () => {
  it("shows Available Credit, Investments, and Net Worth via the same shared FinancialLayersCard Cash Flow uses", () => {
    render(
      <HomeContent
        {...baseProps}
        safeToSpend={safeToSpend({ creditAvailableMinor: 4000000 })}
        investmentTotalMinor={30000000}
        netWorth={{ netWorthMinor: 33500000, totalAssetsMinor: 35500000, totalLiabilitiesMinor: 2000000, currency: "INR" }}
      />,
    );
    expect(screen.getByText("Available Credit")).toBeInTheDocument();
    expect(screen.getByText(/Not included in Safe to Spend/)).toBeInTheDocument();
    expect(screen.getByText("Investments")).toBeInTheDocument();
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("shows no Available Credit / Investments / Net Worth card for a user with none of them", () => {
    render(<HomeContent {...baseProps} investmentTotalMinor={0} netWorth={{ netWorthMinor: 0, totalAssetsMinor: 0, totalLiabilitiesMinor: 0, currency: "INR" }} />);
    expect(screen.queryByText("Net Worth")).not.toBeInTheDocument();
  });
});

describe("<HomeContent> — Spensa launcher (Phase 16 locked decision #2)", () => {
  it("always shows an 'Ask Spensa' launcher linking to a new conversation, regardless of setup state", () => {
    render(<HomeContent {...baseProps} hasAccounts={false} hasBudget={false} hasGoals={false} />);
    const link = screen.getByRole("link", { name: "Chat" });
    expect(link).toHaveAttribute("href", "/spensa/new");
  });
});

describe("<HomeContent> — SP-051 setup-nudge grid", () => {
  it("shows no nudge cards once accounts, a budget, and a goal all exist", () => {
    render(<HomeContent {...baseProps} />);
    expect(screen.queryByText("Complete your setup")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up accounts" })).not.toBeInTheDocument();
  });

  it("shows only the incomplete setup steps, each linking to its existing route", () => {
    render(<HomeContent {...baseProps} hasAccounts={false} hasBudget={false} hasGoals />);
    expect(screen.getByRole("link", { name: "Set up accounts" })).toHaveAttribute("href", "/settings/accounts");
    expect(screen.getByRole("link", { name: "Create a budget" })).toHaveAttribute("href", "/cash-flow/budgets");
    expect(screen.queryByRole("link", { name: "Set a goal" })).not.toBeInTheDocument();
  });

  it("never shows a 'Connect AI Model' nudge -- BYO AI is out of scope this phase", () => {
    render(<HomeContent {...baseProps} hasAccounts={false} hasBudget={false} hasGoals={false} />);
    expect(screen.queryByText(/connect ai model/i)).not.toBeInTheDocument();
  });
});

describe("<HomeContent> — accessibility", () => {
  it("has no axe violations, setup-incomplete state", async () => {
    const { container } = render(<HomeContent {...baseProps} hasAccounts={false} hasBudget={false} hasGoals={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations, setup-complete state", async () => {
    const { container } = render(<HomeContent {...baseProps} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
