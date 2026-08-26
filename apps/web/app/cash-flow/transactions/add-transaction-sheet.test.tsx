import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, CategoryRow } from "@spencare/domain-application";
import { AddTransactionSheet } from "./add-transaction-sheet";

vi.mock("./actions", () => ({
  createTransactionAction: vi.fn(async () => ({ ok: true, value: {} })),
  transferAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { createTransactionAction, transferAction } = await import("./actions");
  vi.mocked(createTransactionAction).mockReset();
  vi.mocked(createTransactionAction).mockResolvedValue({ ok: true, value: {} as never });
  vi.mocked(transferAction).mockReset();
  vi.mocked(transferAction).mockResolvedValue({ ok: true, value: {} as never });
});

const accounts: AccountRow[] = [
  {
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
  },
  {
    id: "97126e31-f576-4e29-8036-eafe20d4dc5e",
    user_id: "u1",
    type: "cash",
    name: "Cash",
    currency: "INR",
    balance_minor: 5_000,
    credit_limit_minor: null,
    credit_used_minor: null,
    market_value_minor: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const categories: CategoryRow[] = [{ id: "289f5e56-21a8-4ee0-865f-c02c11f4d874", user_id: null, name: "Dining", icon: null, is_system: true }];

describe("<AddTransactionSheet> — accessibility", () => {
  it("has no axe violations on the default (Expense) tab", async () => {
    const { container } = render(
      <AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations on the Transfer tab", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />,
    );
    await user.click(screen.getByRole("tab", { name: "Transfer" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    expect(screen.getByRole("button", { name: "Add expense" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<AddTransactionSheet> — expense tab (default)", () => {
  it("requires an account and category before submitting", async () => {
    const { createTransactionAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    expect(createTransactionAction).not.toHaveBeenCalled();
  });

  it("submits a valid expense with kind='expense'", async () => {
    const { createTransactionAction } = await import("./actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={onCreated} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("combobox", { name: "Paid from" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank" }));
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "450");
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    expect(createTransactionAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "expense", accountId: "ea690459-1cda-4b03-860a-9fb65dec3406", categoryId: "289f5e56-21a8-4ee0-865f-c02c11f4d874", amountMinor: 45000 }),
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});

describe("<AddTransactionSheet> — transfer tab", () => {
  it("submits a valid transfer via transferAction, not createTransactionAction", async () => {
    const { transferAction, createTransactionAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("tab", { name: "Transfer" }));
    await user.click(screen.getByRole("combobox", { name: "From" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank" }));
    await user.click(screen.getByRole("combobox", { name: "To" }));
    await user.click(screen.getByRole("option", { name: "Cash" }));
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "1000");
    await user.click(screen.getByRole("button", { name: "Transfer" }));
    expect(transferAction).toHaveBeenCalledWith(
      expect.objectContaining({ fromAccountId: "ea690459-1cda-4b03-860a-9fb65dec3406", toAccountId: "97126e31-f576-4e29-8036-eafe20d4dc5e", amountMinor: 100000 }),
    );
    expect(createTransactionAction).not.toHaveBeenCalled();
  });

  it("rejects transferring an account to itself before submitting", async () => {
    const { transferAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("tab", { name: "Transfer" }));
    await user.click(screen.getByRole("combobox", { name: "From" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank" }));
    await user.click(screen.getByRole("combobox", { name: "To" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank" }));
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "1000");
    await user.click(screen.getByRole("button", { name: "Transfer" }));
    expect(transferAction).not.toHaveBeenCalled();
  });
});

describe("<AddTransactionSheet> — income tab", () => {
  it("submits a valid income with kind='income'", async () => {
    const { createTransactionAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("tab", { name: "Income" }));
    await user.click(screen.getByRole("combobox", { name: "Received into" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank" }));
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "2000000");
    await user.click(screen.getByRole("button", { name: "Add income" }));
    expect(createTransactionAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "income" }));
  });
});
