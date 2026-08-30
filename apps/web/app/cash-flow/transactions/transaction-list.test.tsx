import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { AccountRow, CategoryRow, TransactionRow } from "@spencare/domain-application";
import { TransactionList } from "./transaction-list";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("./actions", () => ({
  createTransactionAction: vi.fn(async () => ({ ok: true, value: {} })),
  transferAction: vi.fn(async () => ({ ok: true, value: {} })),
  updateTransactionAction: vi.fn(async () => ({ ok: true, value: {} })),
  deleteTransactionAction: vi.fn(async () => ({ ok: true, value: undefined })),
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
};

const category: CategoryRow = { id: "cat-1", user_id: null, name: "Dining", icon: null, is_system: true };

function expense(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "txn-1",
    user_id: "u1",
    account_id: "acc-1",
    type: "expense",
    amount_minor: 45000,
    currency: "INR",
    category_id: "cat-1",
    merchant: "Swiggy",
    description: null,
    occurred_at: "2026-08-25",
    status: "posted",
    transfer_pair_id: null,
    goal_id: null,
    bill_prediction_id: null,
    created_at: "2026-08-25T00:00:00Z",
    updated_at: "2026-08-25T00:00:00Z",
    ...overrides,
  };
}

describe("<TransactionList> — empty state", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <TransactionList initialTransactions={[]} accounts={[account]} categories={[category]} masked={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an honest empty state, not fabricated transactions", () => {
    render(<TransactionList initialTransactions={[]} accounts={[account]} categories={[category]} masked={false} />);
    expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
  });
});

describe("<TransactionList> — populated", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <TransactionList initialTransactions={[expense()]} accounts={[account]} categories={[category]} masked={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives each clickable row a real, spaced accessible name (not raw concatenated text content)", () => {
    render(<TransactionList initialTransactions={[expense()]} accounts={[account]} categories={[category]} masked={false} />);
    expect(screen.getByRole("button", { name: "Swiggy, Dining, HDFC Bank · Bank, ₹450.00" })).toBeInTheDocument();
  });

  it("masks the accessible name's amount too, not just the visible figure", () => {
    render(<TransactionList initialTransactions={[expense()]} accounts={[account]} categories={[category]} masked />);
    expect(screen.getByRole("button", { name: "Swiggy, Dining, HDFC Bank · Bank, amount hidden" })).toBeInTheDocument();
  });

  it("excludes a transfer from the day's income/expense subtotal (invariant #4)", () => {
    const transferLeg = expense({
      id: "txn-2",
      type: "transfer",
      category_id: null,
      merchant: null,
      description: "Transfer to Cash",
      amount_minor: 100000,
    });
    render(
      <TransactionList
        initialTransactions={[expense(), transferLeg]}
        accounts={[account]}
        categories={[category]}
        masked={false}
      />,
    );
    // Net for the day is just the expense (-450), not affected by the 1000 transfer.
    expect(screen.getByLabelText(/net total/i)).toHaveTextContent("₹450.00");
  });

  it("opens the transaction detail dialog on row click", async () => {
    const user = userEvent.setup();
    render(<TransactionList initialTransactions={[expense()]} accounts={[account]} categories={[category]} masked={false} />);
    await user.click(screen.getByRole("button", { name: /Swiggy/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("₹450.00")).toBeInTheDocument();
  });

  it("opens the Add transaction sheet from the header button", async () => {
    const user = userEvent.setup();
    render(<TransactionList initialTransactions={[]} accounts={[account]} categories={[category]} masked={false} />);
    await user.click(screen.getByRole("button", { name: "+ Add" }));
    expect(screen.getByRole("heading", { name: "Add transaction" })).toBeInTheDocument();
  });

  it("links to the standalone Import screen (Phase 15), additive alongside + Add, not replacing it", () => {
    render(<TransactionList initialTransactions={[]} accounts={[account]} categories={[category]} masked={false} />);
    expect(screen.getByRole("link", { name: "Import statement" })).toHaveAttribute("href", "/cash-flow/import");
    expect(screen.getByRole("button", { name: "+ Add" })).toBeInTheDocument();
  });
});
