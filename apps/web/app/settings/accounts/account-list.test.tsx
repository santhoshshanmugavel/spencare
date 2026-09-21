import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@spencare/domain-application";
import { AccountList } from "./account-list";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("./actions", () => ({
  createAccountAction: vi.fn(async () => ({ ok: true, value: {} })),
  updateAccountAction: vi.fn(async () => ({ ok: true, value: {} })),
  archiveAccountAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

function bank(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "acc-bank-1",
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
    ...overrides,
  };
}

const creditCard: AccountRow = {
  id: "acc-cc-1",
  user_id: "u1",
  type: "credit_card",
  name: "ICICI Card",
  currency: "INR",
  balance_minor: 0,
  credit_limit_minor: 20000000,
  credit_used_minor: 4500000,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  statement_close_day: null,
  payment_due_day: null,
};

const investment: AccountRow = {
  id: "acc-inv-1",
  user_id: "u1",
  type: "investment",
  name: "Zerodha",
  currency: "INR",
  balance_minor: 0,
  credit_limit_minor: null,
  credit_used_minor: null,
  market_value_minor: 7500000,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  statement_close_day: null,
  payment_due_day: null,
};

describe("<AccountList> — empty state", () => {
  it("has no axe violations", async () => {
    const { container } = render(<AccountList initialAccounts={[]} masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an honest empty state, not fabricated accounts", () => {
    render(<AccountList initialAccounts={[]} masked={false} />);
    expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
  });
});

describe("<AccountList> — populated", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <AccountList initialAccounts={[bank(), creditCard, investment]} masked={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("groups accounts by type with the correct section labels", () => {
    render(<AccountList initialAccounts={[bank(), creditCard, investment]} masked={false} />);
    expect(screen.getByText("Banks")).toBeInTheDocument();
    expect(screen.getByText("Credit Cards")).toBeInTheDocument();
    expect(screen.getByText("Investments")).toBeInTheDocument();
    expect(screen.queryByText("Cash")).not.toBeInTheDocument();
  });

  it("never labels a credit card's available credit as a 'balance'", () => {
    render(<AccountList initialAccounts={[creditCard]} masked={false} />);
    expect(screen.getByText("Credit limit available")).toBeInTheDocument();
    expect(screen.queryByText("Total balance")).not.toBeInTheDocument();
  });

  it("never labels an investment's value as a 'balance' or 'available'", () => {
    render(<AccountList initialAccounts={[investment]} masked={false} />);
    expect(screen.getByText("Total invested")).toBeInTheDocument();
    expect(screen.queryByText(/balance|available/i)).not.toBeInTheDocument();
  });

  it("exposes an accessible, name-specific Actions menu per card (SP-238/SP-239 dropdown, not hover icons)", () => {
    render(<AccountList initialAccounts={[bank()]} masked={false} />);
    expect(screen.getByRole("button", { name: "Actions for HDFC Savings" })).toBeInTheDocument();
  });

  it("Actions menu offers only Edit/Delete this phase -- Add money/View reserved goals/Self transfer/Pay Now need the Transactions/Goals engine and are correctly deferred", async () => {
    const user = userEvent.setup();
    render(<AccountList initialAccounts={[bank()]} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Actions for HDFC Savings" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Edit account" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete account" })).toBeInTheDocument();
    expect(within(menu).queryByText(/add money|view reserved goals|self transfer|pay now/i)).not.toBeInTheDocument();
  });

  it("credit card Actions menu uses card-specific wording (SP-239)", async () => {
    const user = userEvent.setup();
    render(<AccountList initialAccounts={[creditCard]} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Actions for ICICI Card" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Edit credit card" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete credit card" })).toBeInTheDocument();
  });

  it("shows credit card utilization (used / total limit) using existing schema data, not fabricated figures", () => {
    render(<AccountList initialAccounts={[creditCard]} masked={false} />);
    expect(screen.getByText(/used/)).toBeInTheDocument();
    expect(screen.getByText(/total limit/)).toBeInTheDocument();
  });

  it("masks both the headline and the used/total sub-line under Privacy Mode (CF-D09 -- the source screens themselves flag the sub-line as a real leak)", () => {
    render(<AccountList initialAccounts={[creditCard]} masked />);
    expect(screen.queryByText(/₹45,000|₹2,00,000|450|2,00,000/)).not.toBeInTheDocument();
  });

  it("opens the Add Account sheet from the header button", async () => {
    const user = userEvent.setup();
    render(<AccountList initialAccounts={[]} masked={false} />);
    await user.click(screen.getByRole("button", { name: "+ Add account" }));
    expect(screen.getByRole("heading", { name: "Add account" })).toBeInTheDocument();
  });

  it("opens Edit for the clicked account only", async () => {
    const user = userEvent.setup();
    render(<AccountList initialAccounts={[bank(), creditCard]} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Actions for ICICI Card" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit credit card" }));
    expect(screen.getByText("Edit account")).toBeInTheDocument();
    expect(screen.getByText(/Update ICICI Card/)).toBeInTheDocument();
  });

  it("opens the archive confirmation for the clicked account, gated behind a preview (not a single-click destructive action)", async () => {
    const user = userEvent.setup();
    render(<AccountList initialAccounts={[bank()]} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Actions for HDFC Savings" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete account" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("calls archiveAccountAction with the confirmed account's id, not a client-guessed id", async () => {
    const { archiveAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AccountList initialAccounts={[bank()]} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Actions for HDFC Savings" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete account" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(archiveAccountAction).toHaveBeenCalledWith("acc-bank-1");
  });
});
