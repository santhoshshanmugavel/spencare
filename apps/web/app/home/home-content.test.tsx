import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { SafeToSpendState } from "@spencare/domain-application";
import { HomeContent, type SafeToSpendPlain, type NetWorthPlain } from "./home-content";
import type { DashboardMetrics } from "@/components/spencare/dashboard-section";

// jsdom has no real layout engine and doesn't implement HTMLCanvasElement.getContext()
// — ECharts and the DashboardFilterBar router hooks are mocked to no-ops so
// HomeContent's own logic (labels, links, empty/masked states, setup nudges,
// attention cards) can be verified without a real browser environment.
vi.mock("echarts", () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/home",
  useSearchParams: () => new URLSearchParams(),
}));

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

const netWorth: NetWorthPlain = {
  netWorthMinor: 500000,
  totalAssetsMinor: 500000,
  totalLiabilitiesMinor: 0,
  currency: "INR",
};

const blankMetrics: DashboardMetrics = {
  incomeMinor: 0,
  expenseMinor: 0,
  netMinor: 0,
  savingsRatePercent: null,
  incomeDeltaPercent: null,
  expenseDeltaPercent: null,
  currency: "INR",
};

const baseProps = {
  displayName: "Asha",
  masked: false,
  hasAccounts: true,
  hasBudget: true,
  hasGoals: true,
  safeToSpend: safeToSpend(),
  netWorth,
  investmentTotalMinor: 0,
  trendPoints: [],
  dashboardMetrics: blankMetrics,
  categorySlices: [],
  budgetItems: [],
  goalItems: [],
  creditUtilization: null,
  accountOptions: [],
  currentPeriod: "this_month" as const,
  periodLabel: "This month",
  goalsAtRisk: [],
  budgetsNeedingAttention: [],
};

describe("<HomeContent> — Safe-to-Spend header (DD-01)", () => {
  it("labels a plain balance_only state 'Available Balance', never 'Safe to Spend'", () => {
    render(<HomeContent {...baseProps} safeToSpend={safeToSpend({ state: "balance_only" })} />);
    expect(screen.getByText("Available Balance")).toBeInTheDocument();
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
    render(
      <HomeContent
        {...baseProps}
        hasAccounts={false}
        safeToSpend={safeToSpend({ state: "no_accounts", amountMinor: 0 })}
      />,
    );
    // The hero shows a prompt instead of a fabricated ₹0.00 total.
    expect(
      screen.getByText(/add a bank or cash account to see how much you can safely spend/i),
    ).toBeInTheDocument();
  });

  it("masks the header figure (and its breakdown) when Privacy Mode is on", () => {
    render(
      <HomeContent
        {...baseProps}
        masked
        safeToSpend={safeToSpend({ amountMinor: 123456, ownedSpendableMinor: 123456 })}
      />,
    );
    expect(screen.queryByText("₹1,234.56")).not.toBeInTheDocument();
    expect(screen.getAllByText("₹***").length).toBeGreaterThan(0);
  });
});

describe("<HomeContent> — Phase 29: Home matches Cash Flow's financial layers", () => {
  it("shows Available Credit, Investments, and Net Worth via the same shared FinancialLayersCard", () => {
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

  it("shows no Available Credit / Investments / Net Worth card when the user has none", () => {
    render(
      <HomeContent
        {...baseProps}
        investmentTotalMinor={0}
        netWorth={{ netWorthMinor: 0, totalAssetsMinor: 0, totalLiabilitiesMinor: 0, currency: "INR" }}
      />,
    );
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

describe("<HomeContent> — Dashboard filter bar", () => {
  it("renders the period label for the current period", () => {
    render(<HomeContent {...baseProps} periodLabel="Last 3 months" currentPeriod="last_3m" />);
    expect(screen.getAllByText("Last 3 months").length).toBeGreaterThan(0);
  });

  it("renders account filter buttons when accounts are provided", () => {
    render(
      <HomeContent
        {...baseProps}
        accountOptions={[{ id: "acc1", name: "HDFC Savings", type: "bank" }]}
      />,
    );
    // Desktop filter row renders account names inline; the "All accounts" button
    // lives in the mobile Sheet which is only in the DOM when open.
    expect(screen.getByText("HDFC Savings")).toBeInTheDocument();
    expect(screen.getByText("Account:")).toBeInTheDocument();
  });
});

describe("<HomeContent> — Tier 2 metrics section", () => {
  it("renders Income, Spending, Net Cash Flow, and Savings Rate tiles", () => {
    render(
      <HomeContent
        {...baseProps}
        dashboardMetrics={{
          ...blankMetrics,
          incomeMinor: 100000,
          expenseMinor: 70000,
          netMinor: 30000,
          savingsRatePercent: 30,
        }}
        periodLabel="This month"
      />,
    );
    expect(screen.getByText("Income")).toBeInTheDocument();
    expect(screen.getByText("Spending")).toBeInTheDocument();
    expect(screen.getByText("Net Cash Flow")).toBeInTheDocument();
    expect(screen.getByText("Savings Rate")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("hides specific metric values in Privacy Mode", () => {
    render(
      <HomeContent
        {...baseProps}
        masked
        dashboardMetrics={{
          ...blankMetrics,
          incomeMinor: 100000,
          savingsRatePercent: 30,
        }}
      />,
    );
    // Savings rate percentage is hidden
    expect(screen.queryByText("30%")).not.toBeInTheDocument();
  });
});

describe("<HomeContent> — 'Needs your attention' (Level 4)", () => {
  it("shows nothing when no budget or goal needs attention", () => {
    render(<HomeContent {...baseProps} />);
    expect(screen.queryByText("Needs your attention")).not.toBeInTheDocument();
  });

  it("surfaces an over-budget category with a real amount, linking to Budgets", () => {
    render(
      <HomeContent
        {...baseProps}
        budgetsNeedingAttention={[
          { id: "b1", categoryName: "Dining", status: "exceeded", percentUsed: 120, remainingMinor: -50000 },
        ]}
      />,
    );
    expect(screen.getByText("Needs your attention")).toBeInTheDocument();
    expect(screen.getByText(/₹500 over your dining budget/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /dining budget/i })).toHaveAttribute("href", "/cash-flow/budgets");
  });

  it("surfaces a goal behind pace with a real remaining amount, linking to Goals", () => {
    render(
      <HomeContent
        {...baseProps}
        goalsAtRisk={[
          { id: "g1", name: "Bali Trip", remainingMinor: 2000000, targetDate: "2027-03-01", paceStatus: "behind" },
        ]}
      />,
    );
    expect(screen.getByText(/bali trip is behind pace/i)).toBeInTheDocument();
    expect(screen.getByText(/₹20,000 left/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bali trip/i })).toHaveAttribute("href", "/goals");
  });

  it("never reveals exact amounts for attention items when Privacy Mode is on", () => {
    render(
      <HomeContent
        {...baseProps}
        masked
        budgetsNeedingAttention={[
          { id: "b1", categoryName: "Dining", status: "exceeded", percentUsed: 120, remainingMinor: -50000 },
        ]}
        goalsAtRisk={[
          { id: "g1", name: "Bali Trip", remainingMinor: 2000000, targetDate: "2027-03-01", paceStatus: "behind" },
        ]}
      />,
    );
    expect(screen.queryByText(/₹500/)).not.toBeInTheDocument();
    expect(screen.queryByText(/₹20,000/)).not.toBeInTheDocument();
  });
});

describe("<HomeContent> — accessibility", () => {
  it("has no axe violations, setup-incomplete state", async () => {
    const { container } = render(
      <HomeContent {...baseProps} hasAccounts={false} hasBudget={false} hasGoals={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations, setup-complete state", async () => {
    const { container } = render(<HomeContent {...baseProps} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with attention items and metrics populated", async () => {
    const { container } = render(
      <HomeContent
        {...baseProps}
        dashboardMetrics={{ ...blankMetrics, incomeMinor: 500000, expenseMinor: 300000, netMinor: 200000, savingsRatePercent: 40 }}
        budgetsNeedingAttention={[
          { id: "b1", categoryName: "Dining", status: "exceeded", percentUsed: 120, remainingMinor: -50000 },
        ]}
        goalsAtRisk={[
          { id: "g1", name: "Bali Trip", remainingMinor: 2000000, targetDate: "2027-03-01", paceStatus: "behind" },
        ]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
