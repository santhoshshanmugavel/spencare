import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import { TransactionDetailDialog } from "./transaction-detail-dialog";

vi.mock("./actions", () => ({
  updateTransactionAction: vi.fn(async () => ({ ok: true, value: {} })),
  deleteTransactionAction: vi.fn(async () => ({ ok: true, value: undefined })),
  createTransactionAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

const account: AccountRow = {
  id: "acc-1",
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

const category: CategoryRow = { id: "cat-1", user_id: null, name: "Dining", icon: null, is_system: true };

const expenseTxn: TransactionRow = {
  id: "txn-1",
  user_id: "u1",
  account_id: "acc-1",
  type: "expense",
  amount_minor: 45000,
  currency: "INR",
  category_id: "cat-1",
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

const transferLeg: TransactionRow = {
  ...expenseTxn,
  id: "txn-2",
  type: "transfer",
  category_id: null,
  merchant: null,
  description: "Transfer to Cash",
  transfer_pair_id: "txn-3",
};

describe("<TransactionDetailDialog> — accessibility and content", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <TransactionDetailDialog
        transaction={expenseTxn}
        account={account}
        category={category}
        accounts={[account]}
        categories={[category]}
        open
        onOpenChange={() => {}}
        onMutated={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows Edit for an income/expense transaction", () => {
    render(
      <TransactionDetailDialog
        transaction={expenseTxn}
        account={account}
        category={category}
        accounts={[account]}
        categories={[category]}
        open
        onOpenChange={() => {}}
        onMutated={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("does NOT offer Edit for a transfer leg (api-architecture.md §5.1 scopes updateTransaction to income/expense)", () => {
    render(
      <TransactionDetailDialog
        transaction={transferLeg}
        accounts={[account]}
        categories={[category]}
        open
        onOpenChange={() => {}}
        onMutated={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("opens the Edit sheet from the detail dialog", async () => {
    const user = userEvent.setup();
    render(
      <TransactionDetailDialog
        transaction={expenseTxn}
        account={account}
        category={category}
        accounts={[account]}
        categories={[category]}
        open
        onOpenChange={() => {}}
        onMutated={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit transaction" })).toBeInTheDocument();
  });

  it("opens the delete confirmation from the detail dialog", async () => {
    const user = userEvent.setup();
    render(
      <TransactionDetailDialog
        transaction={expenseTxn}
        account={account}
        category={category}
        accounts={[account]}
        categories={[category]}
        open
        onOpenChange={() => {}}
        onMutated={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/delete this expense/i, { ignore: ".sr-only" })).toBeInTheDocument();
  });
});
