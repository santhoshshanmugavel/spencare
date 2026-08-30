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
  {
    id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
    user_id: "u1",
    type: "credit_card",
    name: "ICICI Credit Card",
    currency: "INR",
    balance_minor: 0,
    credit_limit_minor: 10_000_000,
    credit_used_minor: 3_500_000,
    market_value_minor: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d",
    user_id: "u1",
    type: "investment",
    name: "Mutual Fund",
    currency: "INR",
    balance_minor: 0,
    credit_limit_minor: null,
    credit_used_minor: null,
    market_value_minor: 30_000_000,
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
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
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
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
    await user.click(screen.getByRole("combobox", { name: "To" }));
    await user.click(screen.getByRole("option", { name: "Cash · Cash" }));
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
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
    await user.click(screen.getByRole("combobox", { name: "To" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
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
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "2000000");
    await user.click(screen.getByRole("button", { name: "Add income" }));
    expect(createTransactionAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "income" }));
  });
});

describe("<AddTransactionSheet> — Phase 28 account-type capability filtering", () => {
  it("Expense tab shows Credit Card as a valid source, clearly labeled by type", async () => {
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("combobox", { name: "Paid from" }));
    expect(screen.getByRole("option", { name: "ICICI Credit Card · Credit Card" })).toBeInTheDocument();
  });

  it("Expense tab never shows Investment as a source -- not a normal daily-spending account", async () => {
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("combobox", { name: "Paid from" }));
    expect(screen.queryByRole("option", { name: /Mutual Fund/ })).not.toBeInTheDocument();
  });

  it("Income tab never shows Credit Card as a target -- a credit card cannot receive income", async () => {
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("tab", { name: "Income" }));
    await user.click(screen.getByRole("combobox", { name: "Received into" }));
    expect(screen.queryByRole("option", { name: /ICICI Credit Card/ })).not.toBeInTheDocument();
  });

  it("Transfer tab: Credit Card is a valid destination (repayment) but never a valid source", async () => {
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("tab", { name: "Transfer" }));
    await user.click(screen.getByRole("combobox", { name: "From" }));
    expect(screen.queryByRole("option", { name: /ICICI Credit Card/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("combobox", { name: "To" }));
    expect(screen.getByRole("option", { name: "ICICI Credit Card · Credit Card" })).toBeInTheDocument();
  });

  it("submits a credit-card repayment via the Transfer tab", async () => {
    const { transferAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddTransactionSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={accounts} categories={categories} />);
    await user.click(screen.getByRole("tab", { name: "Transfer" }));
    await user.click(screen.getByRole("combobox", { name: "From" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
    await user.click(screen.getByRole("combobox", { name: "To" }));
    await user.click(screen.getByRole("option", { name: "ICICI Credit Card · Credit Card" }));
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "1500");
    await user.click(screen.getByRole("button", { name: "Transfer" }));
    expect(transferAction).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAccountId: "ea690459-1cda-4b03-860a-9fb65dec3406",
        toAccountId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
        amountMinor: 150000,
      }),
    );
  });
});
