import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@spencare/domain-application";
import { EditAccountSheet } from "./edit-account-sheet";

vi.mock("./actions", () => ({
  updateAccountAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { updateAccountAction } = await import("./actions");
  vi.mocked(updateAccountAction).mockReset();
  vi.mocked(updateAccountAction).mockResolvedValue({ ok: true, value: {} as never });
});

const bank: AccountRow = {
  id: "acc-1",
  user_id: "u1",
  type: "bank",
  name: "HDFC Savings",
  currency: "INR",
  balance_minor: 12500000,
  credit_limit_minor: null,
  credit_used_minor: null,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  statement_close_day: null,
  payment_due_day: null,
};

const creditCard: AccountRow = {
  ...bank,
  id: "acc-cc",
  type: "credit_card",
  credit_limit_minor: 20000000,
  credit_used_minor: 4500000,
};

const investment: AccountRow = {
  ...bank,
  id: "acc-inv",
  type: "investment",
  market_value_minor: 7500000,
};

describe("<EditAccountSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <EditAccountSheet account={bank} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("save button is touch-sized (44px minimum target)", () => {
    render(<EditAccountSheet account={bank} open onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute(
      "data-size",
      "touch",
    );
  });
});

describe("<EditAccountSheet> — field scope by account type", () => {
  it("does not offer a type or currency selector (updateAccountSchema excludes them)", () => {
    render(<EditAccountSheet account={bank} open onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.queryByLabelText(/type/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/currency/i)).not.toBeInTheDocument();
  });

  it("bank account: edits name + Available balance, pre-filled from the account", () => {
    render(<EditAccountSheet account={bank} open onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText("Name")).toHaveValue("HDFC Savings");
    expect(screen.getByText("Available balance")).toBeInTheDocument();
    expect(screen.getByLabelText("Available balance")).toHaveValue("125000");
  });

  it("credit card: edits 'Current outstanding balance', not the credit limit", () => {
    render(
      <EditAccountSheet account={creditCard} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    expect(screen.getByText("Current outstanding balance")).toBeInTheDocument();
    expect(screen.queryByText(/credit limit/i)).not.toBeInTheDocument();
  });

  it("investment: edits 'Current value'", () => {
    render(
      <EditAccountSheet account={investment} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    expect(screen.getByText("Current value")).toBeInTheDocument();
  });
});

describe("<EditAccountSheet> — credit card billing cycle", () => {
  const creditCardWithBilling: AccountRow = { ...creditCard, statement_close_day: 20, payment_due_day: 5 };
  const creditCardUnset: AccountRow = { ...creditCard, statement_close_day: null, payment_due_day: null };

  it("uses a day-of-month selector, not a free-form text field, for both billing days", () => {
    render(<EditAccountSheet account={creditCardUnset} open onOpenChange={() => {}} onSaved={() => {}} />);
    const stmtTrigger = screen.getByLabelText("Statement closes");
    const dueTrigger = screen.getByLabelText("Payment due");
    expect(stmtTrigger.tagName).not.toBe("INPUT");
    expect(dueTrigger.tagName).not.toBe("INPUT");
  });

  it("selecting a statement close day shows a live preview computed from the canonical billing cycle", async () => {
    const user = userEvent.setup();
    render(<EditAccountSheet account={creditCardUnset} open onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.queryByText("Next statement closes")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Statement closes"));
    await user.click(await screen.findByRole("option", { name: "20th" }));

    // The preview block renders once a close day is chosen (exact date is
    // relative to "today" at test-run time, so assert the label appears
    // rather than a specific date string).
    expect(await screen.findByText("Next statement closes")).toBeInTheDocument();
  });

  it("pre-fills the selectors from the account's existing billing days and submits them unchanged", async () => {
    const { updateAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(<EditAccountSheet account={creditCardWithBilling} open onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText("Statement closes")).toHaveTextContent("20th");
    expect(screen.getByLabelText("Payment due")).toHaveTextContent("5th");

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateAccountAction).toHaveBeenCalledWith(
      "acc-cc",
      expect.objectContaining({ statementCloseDay: 20, paymentDueDay: 5 }),
    );
  });

  it("changing the payment due day submits the new value", async () => {
    const { updateAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(<EditAccountSheet account={creditCardWithBilling} open onOpenChange={() => {}} onSaved={() => {}} />);

    await user.click(screen.getByLabelText("Payment due"));
    await user.click(await screen.findByRole("option", { name: "Last day of month" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateAccountAction).toHaveBeenCalledWith(
      "acc-cc",
      expect.objectContaining({ statementCloseDay: 20, paymentDueDay: 32 }),
    );
  });
});

describe("<EditAccountSheet> — submission", () => {
  it("submits the updated fields scoped to this account's id and calls onSaved", async () => {
    const { updateAccountAction } = await import("./actions");
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<EditAccountSheet account={bank} open onOpenChange={() => {}} onSaved={onSaved} />);
    const nameField = screen.getByLabelText("Name");
    await user.clear(nameField);
    await user.type(nameField, "HDFC Bank");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateAccountAction).toHaveBeenCalledWith(
      "acc-1",
      expect.objectContaining({ name: "HDFC Bank" }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
