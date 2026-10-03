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
