import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@spencare/domain-application";
import { AccountCard } from "./account-card";

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
  credit_used_minor: 18500000,
};

describe("<AccountCard> — accessibility", () => {
  it("has no axe violations (bank)", async () => {
    const { container } = render(
      <AccountCard account={bank} masked={false} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations (credit card, with utilization bar)", async () => {
    const { container } = render(
      <AccountCard account={creditCard} masked={false} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Actions trigger is touch-sized (44px minimum target)", () => {
    render(<AccountCard account={bank} masked={false} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("button", { name: "Actions for HDFC Savings" })).toHaveAttribute(
      "data-size",
      "touch",
    );
  });
});

describe("<AccountCard> — Actions menu (SP-238/SP-239)", () => {
  it("calls onEdit / onDelete via the menu, not directly on card click", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(<AccountCard account={bank} masked={false} onEdit={onEdit} onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: "Actions for HDFC Savings" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit account" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("Delete is the destructive-styled item", async () => {
    const user = userEvent.setup();
    render(<AccountCard account={bank} masked={false} onEdit={() => {}} onDelete={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Actions for HDFC Savings" }));
    expect(screen.getByRole("menuitem", { name: "Delete account" })).toHaveAttribute(
      "data-variant",
      "destructive",
    );
  });
});

describe("<AccountCard> — credit card utilization", () => {
  it("colors the utilization bar danger at high usage (91% here), success at low usage", () => {
    const { rerender } = render(
      <AccountCard account={creditCard} masked={false} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(document.querySelector('[data-slot="progress-indicator"]')).toHaveClass("bg-destructive");

    rerender(
      <AccountCard
        account={{ ...creditCard, credit_used_minor: 1000000 }}
        masked={false}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(document.querySelector('[data-slot="progress-indicator"]')).toHaveClass("bg-success");
  });
});
