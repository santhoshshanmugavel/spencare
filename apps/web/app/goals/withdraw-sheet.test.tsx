import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, GoalRow } from "@spencare/domain-application";
import { WithdrawSheet } from "./withdraw-sheet";

vi.mock("./actions", () => ({
  withdrawContributionAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { withdrawContributionAction } = await import("./actions");
  vi.mocked(withdrawContributionAction).mockReset();
  vi.mocked(withdrawContributionAction).mockResolvedValue({ ok: true, value: {} as never });
});

const bankAccount: AccountRow = {
  id: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
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
  statement_close_day: null,
  payment_due_day: null,
};

const goal: GoalRow = {
  id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
  user_id: "u1",
  name: "Vietnam Trip",
  target_amount_minor: 5500000,
  target_date: null,
  funding_account_id: bankAccount.id,
  saved_amount_minor: 300000,
  status: "active",
  term: "short",
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

describe("<WithdrawSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <WithdrawSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onWithdrawn={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<WithdrawSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onWithdrawn={() => {}} />);
    expect(screen.getByRole("button", { name: "Withdraw" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<WithdrawSheet> — behavior", () => {
  it("submits a valid withdrawal scoped to this goal", async () => {
    const { withdrawContributionAction } = await import("./actions");
    const onWithdrawn = vi.fn();
    const user = userEvent.setup();
    render(<WithdrawSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onWithdrawn={onWithdrawn} />);
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "2000");
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(withdrawContributionAction).toHaveBeenCalledWith({
      goalId: goal.id,
      accountId: bankAccount.id,
      amountMinor: 200000,
    });
    expect(onWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("surfaces the insufficient-saved-amount error from the server as a clean message, without crashing", async () => {
    const { withdrawContributionAction } = await import("./actions");
    vi.mocked(withdrawContributionAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "withdrawal_failed", message: "You can't withdraw more than the goal's saved amount." },
    });
    const onWithdrawn = vi.fn();
    const user = userEvent.setup();
    render(<WithdrawSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onWithdrawn={onWithdrawn} />);
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "999999");
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(onWithdrawn).not.toHaveBeenCalled();
  });

  it("requires a positive amount before submitting", async () => {
    const { withdrawContributionAction } = await import("./actions");
    const user = userEvent.setup();
    render(<WithdrawSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onWithdrawn={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(withdrawContributionAction).not.toHaveBeenCalled();
  });
});
