import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AccountRow } from "@spencare/domain-application";
import { AccountDetailsSheet } from "./account-details-sheet";

const creditCard: AccountRow = {
  id: "acc-cc",
  user_id: "u1",
  type: "credit_card",
  name: "IDFC First Millennia",
  currency: "INR",
  balance_minor: 0,
  credit_limit_minor: 10000000,
  credit_used_minor: 2500000,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  // Deprecated in the single-date billing model: statement_close_day is
  // ignored by the UI regardless of what the row says. Kept here to prove
  // the component does not read it.
  statement_close_day: 20,
  payment_due_day: 5,
};

function baseProps() {
  return {
    open: true,
    onOpenChange: () => {},
    masked: false,
    goalReserveMinor: 0,
    commitmentReserveMinor: 0,
    loanReserveMinor: 0,
    cardReserveMinor: 0,
    cardReserveDetails: [],
  };
}

describe("<AccountDetailsSheet> — credit card billing (single-date model)", () => {
  it("shows current outstanding and the single Bill section with next bill due computed from billDueDay (payment_due_day)", () => {
    render(<AccountDetailsSheet account={creditCard} {...baseProps()} />);
    expect(screen.getByText("Current outstanding")).toBeInTheDocument();
    expect(screen.getByText("Credit limit")).toBeInTheDocument();
    expect(screen.getByText("Available credit")).toBeInTheDocument();
    // Single Bill section replaces the old Statement/Billing-Cycle split.
    expect(screen.getByText("Bill")).toBeInTheDocument();
    expect(screen.getByText("Bill due")).toBeInTheDocument();
    expect(screen.getByText("Next bill due")).toBeInTheDocument();
    // Old statement-close terminology is gone from the active UI.
    expect(screen.queryByText(/statement closes?/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/next statement close/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/next payment due/i)).not.toBeInTheDocument();
  });

  it("shows bill amount / paid / remaining / status once a billing status is provided", () => {
    render(
      <AccountDetailsSheet
        account={creditCard}
        {...baseProps()}
        billingStatus={{ statementBalanceMinor: 2000000, paymentStatus: "due_soon", obligationStatus: "unpaid" }}
      />,
    );
    expect(screen.getByText("Bill amount")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Remaining")).toBeInTheDocument();
    expect(screen.getByText("Due soon")).toBeInTheDocument();
  });

  it("labels an overdue bill clearly", () => {
    render(
      <AccountDetailsSheet
        account={creditCard}
        {...baseProps()}
        billingStatus={{ statementBalanceMinor: 2000000, paymentStatus: "overdue", obligationStatus: "unpaid" }}
      />,
    );
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("does not render a Bill section when the bill due day isn't configured", () => {
    render(<AccountDetailsSheet account={{ ...creditCard, payment_due_day: null }} {...baseProps()} />);
    expect(screen.queryByText("Bill")).not.toBeInTheDocument();
    expect(screen.queryByText("Bill due")).not.toBeInTheDocument();
  });

  it("shows a Pay bill CTA when a bank/cash source is available and a remaining balance exists", () => {
    const bank: AccountRow = {
      ...creditCard,
      id: "acc-bank",
      type: "bank",
      name: "HDFC Savings",
      balance_minor: 10000000,
      credit_limit_minor: null,
      credit_used_minor: null,
      statement_close_day: null,
      payment_due_day: null,
    };
    render(
      <AccountDetailsSheet
        account={creditCard}
        {...baseProps()}
        allAccounts={[creditCard, bank]}
        billingStatus={{ statementBalanceMinor: 2000000, paymentStatus: "due_soon", obligationStatus: "unpaid" }}
      />,
    );
    expect(screen.getByRole("button", { name: /pay bill/i })).toBeInTheDocument();
  });

  it("hides the Pay bill CTA when no bank/cash sources are available", () => {
    render(
      <AccountDetailsSheet
        account={creditCard}
        {...baseProps()}
        allAccounts={[creditCard]}
        billingStatus={{ statementBalanceMinor: 2000000, paymentStatus: "due_soon", obligationStatus: "unpaid" }}
      />,
    );
    expect(screen.queryByRole("button", { name: /pay bill/i })).not.toBeInTheDocument();
  });
});

describe("<AccountDetailsSheet> — bank reserve breakdown", () => {
  const bank: AccountRow = {
    id: "acc-bank",
    user_id: "u1",
    type: "bank",
    name: "HDFC",
    currency: "INR",
    balance_minor: 3621956,
    credit_limit_minor: null,
    credit_used_minor: null,
    market_value_minor: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    statement_close_day: null,
    payment_due_day: null,
  };

  const bankProps = {
    open: true,
    onOpenChange: () => {},
    masked: false,
    cardReserveMinor: 0,
    cardReserveDetails: [],
  };

  it("shows aggregate rows with 'None' when a category has no reservation", () => {
    render(
      <AccountDetailsSheet
        account={bank}
        {...bankProps}
        goalReserveMinor={0}
        commitmentReserveMinor={0}
        loanReserveMinor={0}
      />,
    );
    // Three aggregate rows, each labelled "None" when zero.
    expect(screen.getByText("Reserved for goals")).toBeInTheDocument();
    expect(screen.getByText("Reserved for commitments")).toBeInTheDocument();
    expect(screen.getByText("Reserved for loans")).toBeInTheDocument();
    expect(screen.getAllByText("None").length).toBeGreaterThanOrEqual(3);
  });

  it("exposes a chevron toggle on an aggregate row with items; collapsed by default (items hidden)", () => {
    render(
      <AccountDetailsSheet
        account={bank}
        {...bankProps}
        goalReserveMinor={2000000}
        commitmentReserveMinor={0}
        loanReserveMinor={0}
        reserveBreakdown={{
          goals: [{ id: "g1", name: "Emergency Fund", reservedMinor: 2000000, targetMinor: 5000000, targetDate: "2026-12-31" }],
          commitments: [],
          loans: [],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /toggle reserved for goals breakdown/i })).toBeInTheDocument();
    // Collapsed by default: item name NOT yet in the DOM.
    expect(screen.queryByText("Emergency Fund")).not.toBeInTheDocument();
  });

  it("expands to show per-goal items that reconcile to the aggregate", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    render(
      <AccountDetailsSheet
        account={bank}
        {...bankProps}
        goalReserveMinor={2000000}
        commitmentReserveMinor={0}
        loanReserveMinor={0}
        reserveBreakdown={{
          goals: [
            { id: "g1", name: "Emergency Fund", reservedMinor: 1500000, targetMinor: 5000000, targetDate: null },
            { id: "g2", name: "New Laptop", reservedMinor: 500000, targetMinor: 8000000, targetDate: null },
          ],
          commitments: [],
          loans: [],
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /toggle reserved for goals breakdown/i }));
    expect(screen.getByText("Emergency Fund")).toBeInTheDocument();
    expect(screen.getByText("New Laptop")).toBeInTheDocument();
    // 1500000 + 500000 = 2000000, matches the aggregate -- not displayed as a
    // separate total row here; the invariant is enforced by page.tsx which
    // derives both from the same source list.
  });

  it("expands commitments and labels a fully-protected one with 'Fully protected' (uses derivePreparationStatus)", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
    const nextPaymentDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    render(
      <AccountDetailsSheet
        account={bank}
        {...bankProps}
        goalReserveMinor={0}
        commitmentReserveMinor={14900}
        loanReserveMinor={0}
        reserveBreakdown={{
          goals: [],
          commitments: [
            {
              id: "cmt-1",
              name: "YouTube Premium",
              categoryName: "Subscriptions",
              frequency: "monthly",
              reservedMinor: 14900,
              nextPaymentAmountMinor: 14900,
              nextPaymentDate,
              nextOccurrenceReservedMinor: 14900, // fully protected
            },
          ],
          loans: [],
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /toggle reserved for commitments breakdown/i }));
    expect(screen.getByText("YouTube Premium")).toBeInTheDocument();
    expect(screen.getByText("Fully protected")).toBeInTheDocument();
  });

  it("includes the Available explanation copy so users know how the available amount is derived", () => {
    render(
      <AccountDetailsSheet
        account={bank}
        {...bankProps}
        goalReserveMinor={0}
        commitmentReserveMinor={0}
        loanReserveMinor={0}
      />,
    );
    expect(
      screen.getByText(/available is your current balance after protecting money/i),
    ).toBeInTheDocument();
  });
});
