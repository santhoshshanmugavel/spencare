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

describe("<AccountDetailsSheet> — credit card billing", () => {
  it("shows current outstanding and billing cycle dates from the canonical calculation even without a billing status prop", () => {
    render(<AccountDetailsSheet account={creditCard} {...baseProps()} />);
    expect(screen.getByText("Current outstanding")).toBeInTheDocument();
    expect(screen.getByText("Next statement close")).toBeInTheDocument();
    expect(screen.getByText("Next payment due")).toBeInTheDocument();
    // No billingStatus was passed, so statement balance / payment status rows are absent rather than fabricated.
    expect(screen.queryByText("Statement balance")).not.toBeInTheDocument();
    expect(screen.queryByText("Payment status")).not.toBeInTheDocument();
  });

  it("shows the statement balance and payment status once a billing status is provided, distinct from current outstanding", () => {
    render(
      <AccountDetailsSheet
        account={creditCard}
        {...baseProps()}
        billingStatus={{ statementBalanceMinor: 2000000, paymentStatus: "due_soon", obligationStatus: "unpaid" }}
      />,
    );
    expect(screen.getByText("Statement balance")).toBeInTheDocument();
    expect(screen.getByText("Current outstanding")).toBeInTheDocument();
    expect(screen.getByText("Due soon")).toBeInTheDocument();
  });

  it("labels an overdue statement clearly", () => {
    render(
      <AccountDetailsSheet
        account={creditCard}
        {...baseProps()}
        billingStatus={{ statementBalanceMinor: 2000000, paymentStatus: "overdue", obligationStatus: "unpaid" }}
      />,
    );
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("does not render a Billing Cycle section when no billing days are configured", () => {
    render(<AccountDetailsSheet account={{ ...creditCard, statement_close_day: null, payment_due_day: null }} {...baseProps()} />);
    expect(screen.queryByText("Billing Cycle")).not.toBeInTheDocument();
  });
});
