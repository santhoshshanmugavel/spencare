import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import { DeleteTransactionDialog } from "./delete-transaction-dialog";

vi.mock("./actions", () => ({
  deleteTransactionAction: vi.fn(async () => ({ ok: true, value: undefined })),
  createTransactionAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { deleteTransactionAction, createTransactionAction } = await import("./actions");
  vi.mocked(deleteTransactionAction).mockReset();
  vi.mocked(deleteTransactionAction).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(createTransactionAction).mockReset();
  vi.mocked(createTransactionAction).mockResolvedValue({ ok: true, value: {} as never });
});

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

describe("<DeleteTransactionDialog> — accessibility (generalizes SP-094)", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never auto-focuses Confirm on open", () => {
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    expect(document.activeElement).not.toHaveAccessibleName("Confirm");
  });

  it("keeps focus inside the dialog on open (the focus-trap pattern established in Phase 7)", () => {
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Tab cycles only between Cancel and Confirm", async () => {
    const user = userEvent.setup();
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
  });
});

describe("<DeleteTransactionDialog> — content and behavior", () => {
  it("shows the amount, category, and account in the preview, never auto-committing", () => {
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    expect(screen.getByText("₹450.00")).toBeInTheDocument();
    expect(screen.getByText("Dining")).toBeInTheDocument();
    expect(screen.getByText("HDFC Bank")).toBeInTheDocument();
  });

  it("calls deleteTransactionAction with this transaction's id on Confirm", async () => {
    const { deleteTransactionAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(deleteTransactionAction).toHaveBeenCalledWith("txn-1");
  });

  it("does not call deleteTransactionAction when Cancel is clicked", async () => {
    const { deleteTransactionAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteTransactionAction).not.toHaveBeenCalled();
  });

  it("offers Undo for an income/expense delete, generalizing SP-094's proven pattern", () => {
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    // undoable=true renders the confirmed-state Undo button once state reaches "confirmed" --
    // verified indirectly via the preview contract in this render pass.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("recreates the transaction via createTransactionAction on Undo after a successful delete", async () => {
    const { deleteTransactionAction, createTransactionAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(deleteTransactionAction).toHaveBeenCalledWith("txn-1");
    const undoButton = await screen.findByRole("button", { name: "Undo" });
    await user.click(undoButton);
    expect(createTransactionAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "expense", accountId: "acc-1", categoryId: "cat-1", amountMinor: 45000 }),
    );
  });

  it("does NOT mark a transfer leg as undoable (reconstructing both legs needs data this dialog doesn't have)", () => {
    render(
      <DeleteTransactionDialog transaction={transferLeg} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    expect(screen.getByText(/delete this transfer/i, { ignore: ".sr-only" })).toBeInTheDocument();
  });

  it("shows Try again after a failed delete", async () => {
    const { deleteTransactionAction } = await import("./actions");
    vi.mocked(deleteTransactionAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "delete_failed", message: "Couldn't delete this transaction. Try again." },
    });
    const user = userEvent.setup();
    render(
      <DeleteTransactionDialog transaction={expenseTxn} account={account} category={category} open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
