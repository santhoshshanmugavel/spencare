import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import { EditTransactionSheet } from "./edit-transaction-sheet";

vi.mock("./actions", () => ({
  updateTransactionAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { updateTransactionAction } = await import("./actions");
  vi.mocked(updateTransactionAction).mockReset();
  vi.mocked(updateTransactionAction).mockResolvedValue({ ok: true, value: {} as never });
});

const account: AccountRow = {
  id: "ea690459-1cda-4b03-860a-9fb65dec3406",
  user_id: "u1",
  type: "bank",
  name: "HDFC Bank",
  currency: "INR",
  balance_minor: 1_000_000,
  credit_limit_minor: null,
  credit_used_minor: null,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  statement_generated_day: null,
  payment_due_day: null,
};

const category: CategoryRow = {
  id: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
  user_id: null,
  name: "Dining",
  icon: null,
  is_system: true,
};

const creditCardAccount: AccountRow = {
  ...account,
  id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
  type: "credit_card",
  name: "ICICI Credit Card",
  balance_minor: 0,
  credit_limit_minor: 10_000_000,
  credit_used_minor: 3_500_000,
};

const investmentAccount: AccountRow = {
  ...account,
  id: "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d",
  type: "investment",
  name: "Mutual Fund",
  balance_minor: 0,
  market_value_minor: 30_000_000,
};

const expenseTxn: TransactionRow = {
  id: "txn-1",
  user_id: "u1",
  account_id: account.id,
  type: "expense",
  amount_minor: 45000,
  currency: "INR",
  category_id: category.id,
  merchant: "Swiggy",
  item_name: null,
  description: null,
  occurred_at: "2026-08-25",
  status: "posted",
  transfer_pair_id: null,
  goal_id: null,
  bill_prediction_id: null,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

const incomeTxn: TransactionRow = { ...expenseTxn, id: "txn-2", type: "income" };

describe("<EditTransactionSheet> — Phase 28 account-type capability filtering", () => {
  it("an expense can be reassigned to a Credit Card, clearly labeled by type", async () => {
    const { updateTransactionAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <EditTransactionSheet
        transaction={expenseTxn}
        accounts={[account, creditCardAccount, investmentAccount]}
        categories={[category]}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Account" }));
    expect(screen.getByRole("option", { name: "ICICI Credit Card · Credit Card" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Mutual Fund/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "ICICI Credit Card · Credit Card" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateTransactionAction).toHaveBeenCalledWith("txn-1", expect.objectContaining({ accountId: creditCardAccount.id }));
  });

  it("an income transaction never offers a Credit Card as its account -- a credit card cannot receive income", async () => {
    const user = userEvent.setup();
    render(
      <EditTransactionSheet
        transaction={incomeTxn}
        accounts={[account, creditCardAccount]}
        categories={[category]}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Account" }));
    expect(screen.queryByRole("option", { name: /ICICI Credit Card/ })).not.toBeInTheDocument();
  });
});

describe("<EditTransactionSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <EditTransactionSheet transaction={expenseTxn} accounts={[account]} categories={[category]} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("save button is touch-sized", () => {
    render(
      <EditTransactionSheet transaction={expenseTxn} accounts={[account]} categories={[category]} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<EditTransactionSheet> — pre-fill and submission", () => {
  it("pre-fills amount and merchant from the transaction", () => {
    render(
      <EditTransactionSheet transaction={expenseTxn} accounts={[account]} categories={[category]} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    expect(screen.getByLabelText("Amount (INR ₹)")).toHaveValue("450");
    expect(screen.getByLabelText("Merchant / Store name (optional)")).toHaveValue("Swiggy");
  });

  it("submits the updated amount scoped to this transaction's id", async () => {
    const { updateTransactionAction } = await import("./actions");
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <EditTransactionSheet transaction={expenseTxn} accounts={[account]} categories={[category]} open onOpenChange={() => {}} onSaved={onSaved} />,
    );
    const amountField = screen.getByLabelText("Amount (INR ₹)");
    await user.clear(amountField);
    await user.type(amountField, "500");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateTransactionAction).toHaveBeenCalledWith(
      "txn-1",
      expect.objectContaining({ amountMinor: 50000, accountId: account.id, categoryId: category.id }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
