import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type {
  AccountRow,
  BudgetWithUsage,
  CashFlowPeriodComparison,
  CategoryRow,
  TransactionRow,
  UpcomingProjection,
} from "@spencare/domain-application";
import { CashFlowOverview } from "./cash-flow-overview";

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
  statement_generated_day: null,
  payment_due_day: null,
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
  item_name: null,
  description: null,
  occurred_at: "2026-08-10",
  status: "posted",
  transfer_pair_id: null,
  goal_id: null,
  bill_prediction_id: null,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

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
  upcomingProjection: {
    events: [],
    paymentDueMinor: 0,
    preparationMinor: 0,
    goalContributionMinor: 0,
    loanInstallmentMinor: 0,
    creditCardPaymentDueMinor: 0,
    currency: "INR",
  } as UpcomingProjection,
  budgetUsages: [] as BudgetWithUsage[],
};

describe("<CashFlowOverview> — no accounts (empty state)", () => {
  it("shows an honest empty state with a setup CTA, nothing fabricated", async () => {
    const { container } = render(<CashFlowOverview {...baseProps} accounts={[]} />);
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

describe("<CashFlowOverview> — Phase 35 reference-fidelity correction: no global Safe-to-Spend/Net Worth strip on this page", () => {
  /**
   * `Cash Flow.pdf` / `Cash Flow-1.pdf` / `Cash Flow - Recent
   * Transactions-1.pdf` / `Cash Flow Overview.pdf`/`-1.pdf`/`After
   * Budget.pdf` -- four independent reference screens, all consistent --
   * show NO global Safe-to-Spend or Net Worth card on this page. Home
   * already owns that figure; this page's own budget panel already
   * answers the page-scoped "how much can I spend" question. Removed in
   * this phase; this test guards against it silently returning.
   */
  it("does not render a global Safe to Spend or Net Worth card on the All-accounts view", () => {
    render(<CashFlowOverview {...baseProps} />);
    expect(screen.queryByText("Safe to Spend")).not.toBeInTheDocument();
    expect(screen.queryByText("Net Worth")).not.toBeInTheDocument();
    expect(screen.queryByText("Investments")).not.toBeInTheDocument();
  });

  it("still shows the selected account's own plain balance, clearly labeled, when one account is filtered", () => {
    render(<CashFlowOverview {...baseProps} selectedAccountId="acc-1" selectedAccount={bankAccount} />);
    expect(screen.getByText(/Available Balance -- HDFC Bank/)).toBeInTheDocument();
    expect(screen.queryByText("Safe to Spend")).not.toBeInTheDocument();
  });
});

describe("<CashFlowOverview> — budget panel label (Phase 30B reference-fidelity correction supersedes the prior locked decision #4 for THIS widget)", () => {
  /**
   * Phase 30B's reference PDF (Cash Flow - Recent Transactions-4.pdf)
   * literally reads "Available to spend this month / ₹19,301 / ₹53,700
   * budget" for this exact right-panel widget -- Phase 30B's own explicit,
   * repeated rule is "If the implementation... differs from the
   * reference, the reference wins," which supersedes the prior "never
   * Available to spend for budget-only" decision for this one widget.
   * The original rule's purpose -- not conflating this with the broader
   * Safe-to-Spend feature -- still holds: Safe-to-Spend's own hero card
   * (`SafeToSpendHeroCard`, tested above) never uses this phrase, and this
   * widget's own "/ ₹Y budget" + "Spend limits" context scopes it
   * unambiguously to the budget feature, matching the reference exactly.
   */
  it("shows 'Available to spend this month' with the budget total, once a budget exists", () => {
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
    expect(screen.getByText("Available to spend this month")).toBeInTheDocument();
    expect(screen.getByText("Spend limits")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit budget" })).toHaveAttribute("href", "/cash-flow/budgets");
  });

  /**
   * REGRESSION (Phase 32 live verification): the "/ ₹Y budget" total next
   * to the remaining figure was built as a hardcoded `formatAmount(...)`
   * string, bypassing `<Money masked>` entirely -- found live by toggling
   * Privacy Mode on and reading real amounts still showing on screen next
   * to correctly-masked ones. Every figure in this widget must route
   * through `<Money masked>`, no exceptions for "just the total."
   */
  it("masks the budget total (never just the remaining figure) when Privacy Mode is on", () => {
    render(
      <CashFlowOverview
        {...baseProps}
        masked
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
    expect(screen.queryByText(/₹6,000/)).not.toBeInTheDocument();
    expect(screen.getAllByText("₹***").length).toBeGreaterThan(0);
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

describe("<CashFlowOverview> — in-page tab switcher (Recent Transactions / Upcoming)", () => {
  it("uses real tab semantics, not plain links", () => {
    render(<CashFlowOverview {...baseProps} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("switches to Upcoming content on click, with correct aria-selected", async () => {
    const user = userEvent.setup();
    render(
      <CashFlowOverview
        {...baseProps}
        upcomingProjection={{
          events: [
            {
              id: "proj:commitment_payment:c1:2026-09-15",
              kind: "commitment_payment",
              date: "2026-09-15",
              title: "Netflix",
              subtitle: "Monthly",
              amountMinor: 49900,
              currency: "INR",
              sourceId: "c1",
              projected: true,
            },
          ],
          paymentDueMinor: 49900,
          preparationMinor: 0,
          goalContributionMinor: 0,
          loanInstallmentMinor: 0,
          creditCardPaymentDueMinor: 0,
          currency: "INR",
        }}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /upcoming/i }));
    expect(screen.getByRole("tab", { name: /upcoming/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view full schedule/i })).toHaveAttribute("href", "/cash-flow/upcoming");
  });

  it("shows a count badge on the Upcoming tab when events exist", () => {
    render(
      <CashFlowOverview
        {...baseProps}
        upcomingProjection={{
          events: [
            {
              id: "proj:commitment_payment:c1:2026-09-15",
              kind: "commitment_payment",
              date: "2026-09-15",
              title: "Netflix",
              subtitle: "Monthly",
              amountMinor: 49900,
              currency: "INR",
              sourceId: "c1",
              projected: true,
            },
          ],
          paymentDueMinor: 49900,
          preparationMinor: 0,
          goalContributionMinor: 0,
          loanInstallmentMinor: 0,
          creditCardPaymentDueMinor: 0,
          currency: "INR",
        }}
      />,
    );
    expect(screen.getByRole("tab", { name: /Upcoming in \w+ \(1\)/ })).toBeInTheDocument();
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
    render(<CashFlowOverview {...baseProps} accounts={[bankAccount, creditCard]} selectedAccountId="cc-1" selectedAccount={creditCard} />);
    expect(screen.getByText(/Available Credit -- Amex/)).toBeInTheDocument();
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
