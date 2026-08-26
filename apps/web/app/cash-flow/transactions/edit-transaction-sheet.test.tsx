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
};

const category: CategoryRow = {
  id: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
  user_id: null,
  name: "Dining",
  icon: null,
  is_system: true,
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
  description: null,
  occurred_at: "2026-08-25",
  status: "posted",
  transfer_pair_id: null,
  goal_id: null,
  bill_prediction_id: null,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

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
    expect(screen.getByLabelText("Merchant / description")).toHaveValue("Swiggy");
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
