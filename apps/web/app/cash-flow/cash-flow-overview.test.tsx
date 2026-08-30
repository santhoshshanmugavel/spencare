import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type {
  AccountRow,
  BillPredictionWithDefinition,
  BudgetWithUsage,
  CashFlowPeriodComparison,
  CategoryRow,
  SafeToSpendState,
  TransactionRow,
} from "@spencare/domain-application";
import { CashFlowOverview, type SafeToSpendPlain } from "./cash-flow-overview";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const bankAccount: AccountRow = {
  id: "acc-1",
  user_id: "user-a",
  type: "bank",
  name: "HDFC Bank",
  currency: "INR",
  balance_minor: 100000,
  credit_limit_minor: null,
  credit_used_minor: null,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const diningCategory: CategoryRow = { id: "dining", user_id: null, name: "Dining", icon: "utensils", is_system: true };

function comparison(overrides: Partial<CashFlowPeriodComparison> = {}): CashFlowPeriodComparison {
  return {
    current: { incomeMinor: 20000, expenseMinor: 5000, netMinor: 15000 },
    previous: { incomeMinor: 0, expenseMinor: 4000, netMinor: -4000 },
    income: { currentMinor: 20000, previousMinor: 0, deltaMinor: 20000, deltaPercent: null },
    expense: { currentMinor: 5000, previousMinor: 4000, deltaMinor: 1000, deltaPercent: 25 },
    net: { currentMinor: 15000, previousMinor: -4000, deltaMinor: 19000, deltaPercent: null },
    ...overrides,
  };
}

const transaction: TransactionRow = {
  id: "t1",
  user_id: "user-a",
  account_id: "acc-1",
  type: "expense",
  amount_minor: 5000,
  currency: "INR",
  category_id: "dining",
  merchant: "Swiggy",
  description: null,
  occurred_at: "2026-08-10",
  status: "posted",
  transfer_pair_id: null,
  goal_id: null,
  bill_prediction_id: null,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

// Deliberately plain data, matching the real defect fix (SafeToSpendPlain) --
// a real `Money`-bearing `SafeToSpendResult` cannot cross the Server/Client
// boundary in the real app (it carries a `toJSON` method), so this
// component's actual prop type is this plain shape, not the domain-core one.
function safeToSpend(overrides: Partial<SafeToSpendPlain> = {}): SafeToSpendPlain {
  return {
    state: "balance_only" as SafeToSpendState,
    amountMinor: 100000,
    currency: "INR",
    ownedSpendableMinor: 100000,
    creditAvailableMinor: 0,
    goalReservedMinor: 0,
    upcomingBillsMinor: 0,
    ...overrides,
  };
}

const baseProps = {
  periodStart: "2026-08-01",
  accounts: [bankAccount],
  selectedAccountId: undefined,
  selectedAccount: null,
  categories: [diningCategory],
  masked: false,
  comparison: comparison(),
  expenseByCategory: [{ categoryId: "dining", amountMinor: 5000, percent: 100 }],
  incomeByCategory: [],
  recentTransactions: [transaction],
  upcomingBills: [] as BillPredictionWithDefinition[],
  budgetUsages: [] as BudgetWithUsage[],
  safeToSpend: safeToSpend(),
  netWorth: { netWorthMinor: 100000, totalAssetsMinor: 100000, totalLiabilitiesMinor: 0, currency: "INR" },
  investmentTotalMinor: 0,
};

describe("<CashFlowOverview> — no accounts (empty state)", () => {
  it("shows an honest empty state with a setup CTA, nothing fabricated", async () => {
    const { container } = render(<CashFlowOverview {...baseProps} accounts={[]} safeToSpend={null} />);
    expect(screen.getByText(/add an account to see your cash flow/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add an account" })).toHaveAttribute("href", "/settings/accounts");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<CashFlowOverview> — accounts but no transactions", () => {
  it("shows an honest empty transactions state, not a fabricated row", () => {
    render(<CashFlowOverview {...baseProps} recentTransactions={[]} expenseByCategory={[]} />);
    expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
  });
});

describe("<CashFlowOverview> — header metric (locked decision #4/#5)", () => {
  it("shows the real Safe to Spend when All accounts is selected", () => {
    render(<CashFlowOverview {...baseProps} safeToSpend={safeToSpend({ state: "budget_and_goals" })} />);
    expect(screen.getByText("Safe to Spend")).toBeInTheDocument();
    expect(screen.queryByText("Available to spend")).not.toBeInTheDocument();
  });

  it("labels a plain balance_only state 'Available Balance', not 'Safe to Spend'", () => {
    render(<CashFlowOverview {...baseProps} safeToSpend={safeToSpend({ state: "balance_only" })} />);
    expect(screen.getByText("Available Balance")).toBeInTheDocument();
  });

  it("shows the selected account's own plain balance, clearly labeled, when one account is filtered -- never as if it were Safe to Spend", () => {
    render(<CashFlowOverview {...baseProps} selectedAccountId="acc-1" selectedAccount={bankAccount} safeToSpend={null} />);
    expect(screen.getByText(/Available Balance -- HDFC Bank/)).toBeInTheDocument();
    expect(screen.queryByText("Safe to Spend")).not.toBeInTheDocument();
  });
});

describe("<CashFlowOverview> — budget panel label (locked decision #4: never 'Available to spend' for budget-only)", () => {
  it("shows 'Budget remaining', never 'Available to spend', once a budget exists", () => {
    render(
      <CashFlowOverview
        {...baseProps}
        budgetUsages={[
          {
            id: "b1",
            categoryId: "dining",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-31",
            limitMinor: 600000,
            spentMinor: 470000,
            remainingMinor: 130000,
            percentUsed: 78.3,
            status: "near_limit",
            isRecurring: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("Budget remaining")).toBeInTheDocument();
    expect(screen.queryByText(/available to spend/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit budget" })).toHaveAttribute("href", "/cash-flow/budgets");
  });

  it("shows the donut with a Spending/Income toggle when no budget exists", () => {
    render(<CashFlowOverview {...baseProps} />);
    expect(screen.getByRole("button", { name: "Spending" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Income" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up budgets" })).toHaveAttribute("href", "/cash-flow/budgets");
  });
});

describe("<CashFlowOverview> — CF-D07: donut never shows a Goals slice", () => {
  it("only shows real expense categories in the donut legend", () => {
    render(<CashFlowOverview {...baseProps} />);
    // "Dining" legitimately appears twice -- the transaction preview's own
    // category metadata, and the donut legend -- both real, both expected.
    expect(screen.getAllByText("Dining").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Goals")).not.toBeInTheDocument();
  });
});

describe("<CashFlowOverview> — in-page tab switcher (Recent Transactions / Upcoming Bills)", () => {
  it("uses real tab semantics, not plain links", () => {
    render(<CashFlowOverview {...baseProps} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("switches to Upcoming Bills content on click, with correct aria-selected", async () => {
    const user = userEvent.setup();
    render(
      <CashFlowOverview
        {...baseProps}
        upcomingBills={[
          {
            id: "p1",
            bill_definition_id: "bill-1",
            user_id: "user-a",
            expected_date: "2026-09-15",
            expected_amount_minor: 49900,
            status: "open",
            matched_transaction_id: null,
            matched_at: null,
            created_at: "",
            updated_at: "",
            bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: null },
            matched_transaction: null,
          },
        ]}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /upcoming bills/i }));
    expect(screen.getByRole("tab", { name: /upcoming bills/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all bills/i })).toHaveAttribute("href", "/cash-flow/bills");
  });

  it("shows a count badge on the Upcoming Bills tab when bills exist", () => {
    render(
      <CashFlowOverview
        {...baseProps}
        upcomingBills={[
          {
            id: "p1",
            bill_definition_id: "bill-1",
            user_id: "user-a",
            expected_date: "2026-09-15",
            expected_amount_minor: 49900,
            status: "open",
            matched_transaction_id: null,
            matched_at: null,
            created_at: "",
            updated_at: "",
            bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: null },
            matched_transaction: null,
          },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Upcoming bills (1)" })).toBeInTheDocument();
  });
});

describe("<CashFlowOverview> — account filter and month stepper", () => {
  it("navigates with the selected account id when the filter changes", async () => {
    const user = userEvent.setup();
    render(<CashFlowOverview {...baseProps} />);
    await user.click(screen.getByRole("combobox", { name: "Filter by account" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
    expect(push).toHaveBeenCalledWith("/cash-flow?month=2026-08-01&account=acc-1");
  });

  it("navigates to the next month on the month stepper", async () => {
    const user = userEvent.setup();
    render(<CashFlowOverview {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(push).toHaveBeenCalledWith("/cash-flow?month=2026-09-01");
  });

  it("Phase 28: offers Credit Card in the filter too (now Safe-to-Spend-eligible) but never Investment -- SP-092's full rollup panel is still out of scope", async () => {
    const user = userEvent.setup();
    const creditCard: AccountRow = { ...bankAccount, id: "cc-1", type: "credit_card", name: "Amex" };
    const investment: AccountRow = { ...bankAccount, id: "inv-1", type: "investment", name: "Mutual Fund", balance_minor: 0, market_value_minor: 30_000_000 };
    render(<CashFlowOverview {...baseProps} accounts={[bankAccount, creditCard, investment]} />);
    await user.click(screen.getByRole("combobox", { name: "Filter by account" }));
    expect(screen.getByRole("option", { name: "HDFC Bank · Bank" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Amex · Credit Card" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Mutual Fund/ })).not.toBeInTheDocument();
  });

  it("Phase 28: selecting a Credit Card shows 'Available Credit' (limit minus used), never a meaningless balance", () => {
    const creditCard: AccountRow = {
      ...bankAccount,
      id: "cc-1",
      type: "credit_card",
      name: "Amex",
      balance_minor: 0,
      credit_limit_minor: 10_000_000,
      credit_used_minor: 3_500_000,
    };
    render(<CashFlowOverview {...baseProps} accounts={[bankAccount, creditCard]} selectedAccountId="cc-1" selectedAccount={creditCard} safeToSpend={null} />);
    expect(screen.getByText(/Available Credit -- Amex/)).toBeInTheDocument();
  });

  it("Phase 29 REVERSAL: shows an 'Owned money' breakdown line under the hero, never a 'Bank + Cash / Credit Available' composition implying credit is part of the number", () => {
    render(
      <CashFlowOverview
        {...baseProps}
        safeToSpend={safeToSpend({ state: "budget_and_goals", amountMinor: 5500000, ownedSpendableMinor: 5500000, creditAvailableMinor: 4000000 })}
      />,
    );
    expect(screen.getByText("Safe to Spend")).toBeInTheDocument();
    expect(screen.getByText(/Owned money/)).toBeInTheDocument();
    expect(screen.queryByText(/Bank \+ Cash ₹/)).not.toBeInTheDocument();
  });

  it("Phase 29: shows Available Credit as its OWN separate card, explicitly labeled as not included in Safe to Spend", () => {
    render(
      <CashFlowOverview
        {...baseProps}
        safeToSpend={safeToSpend({ state: "budget_and_goals", amountMinor: 5500000, ownedSpendableMinor: 5500000, creditAvailableMinor: 4000000 })}
      />,
    );
    expect(screen.getByText("Available Credit")).toBeInTheDocument();
    expect(screen.getByText(/Not included in Safe to Spend/)).toBeInTheDocument();
  });

  it("does not show the Available Credit card when the user has no credit cards", () => {
    render(<CashFlowOverview {...baseProps} safeToSpend={safeToSpend({ state: "budget_and_goals", creditAvailableMinor: 0 })} />);
    expect(screen.queryByText("Available Credit")).not.toBeInTheDocument();
  });

  it("Phase 29: shows 'Reserved for goals' and 'Upcoming bills' breakdown lines when they're non-zero, never when zero", () => {
    const { rerender } = render(
      <CashFlowOverview {...baseProps} safeToSpend={safeToSpend({ state: "budget_and_goals", goalReservedMinor: 800000, upcomingBillsMinor: 700000 })} />,
    );
    expect(screen.getByText(/Reserved for goals/)).toBeInTheDocument();
    // "Upcoming bills" also names the unrelated preview tab elsewhere on
    // this page -- when the breakdown line is showing, there are two
    // matches instead of the tab's one.
    expect(screen.getAllByText(/Upcoming bills/)).toHaveLength(2);

    rerender(<CashFlowOverview {...baseProps} safeToSpend={safeToSpend({ state: "balance_only", goalReservedMinor: 0, upcomingBillsMinor: 0 })} />);
    expect(screen.queryByText(/Reserved for goals/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Upcoming bills/)).toHaveLength(1);
  });

  it("Phase 28 Part 15/16: shows Investments and Net Worth as separate figures from Safe to Spend, never summed into it", () => {
    render(
      <CashFlowOverview
        {...baseProps}
        investmentTotalMinor={30_000_000}
        netWorth={{ netWorthMinor: 33_500_000, totalAssetsMinor: 35_500_000, totalLiabilitiesMinor: 2_000_000, currency: "INR" }}
      />,
    );
    expect(screen.getByText("Investments")).toBeInTheDocument();
    expect(screen.getByText("Net Worth")).toBeInTheDocument();
  });

  it("does not show the Investments/Net Worth card for a user with no investments and no liabilities", () => {
    render(<CashFlowOverview {...baseProps} investmentTotalMinor={0} netWorth={{ netWorthMinor: 0, totalAssetsMinor: 0, totalLiabilitiesMinor: 0, currency: "INR" }} />);
    expect(screen.queryByText("Net Worth")).not.toBeInTheDocument();
  });

  it("hides the Investments/Net Worth card when a single account is filtered (it already has its own clearly-labeled figure)", () => {
    render(
      <CashFlowOverview
        {...baseProps}
        selectedAccountId="acc-1"
        selectedAccount={bankAccount}
        safeToSpend={null}
        investmentTotalMinor={30_000_000}
        netWorth={{ netWorthMinor: 33_500_000, totalAssetsMinor: 35_500_000, totalLiabilitiesMinor: 2_000_000, currency: "INR" }}
      />,
    );
    expect(screen.queryByText("Net Worth")).not.toBeInTheDocument();
  });
});

describe("<CashFlowOverview> — Privacy Mode", () => {
  it("masks the header metric, the donut, and the transaction preview all at once", () => {
    render(<CashFlowOverview {...baseProps} masked />);
    expect(screen.queryByText("₹1,000.00")).not.toBeInTheDocument();
    const masks = screen.getAllByText("₹***");
    expect(masks.length).toBeGreaterThan(2);
  });
});

describe("<CashFlowOverview> — accessibility", () => {
  it("has no axe violations, populated state", async () => {
    const { container } = render(<CashFlowOverview {...baseProps} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with a budget panel shown", async () => {
    const { container } = render(
      <CashFlowOverview
        {...baseProps}
        budgetUsages={[
          {
            id: "b1",
            categoryId: "dining",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-31",
            limitMinor: 600000,
            spentMinor: 470000,
            remainingMinor: 130000,
            percentUsed: 78.3,
            status: "near_limit",
            isRecurring: false,
          },
        ]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
