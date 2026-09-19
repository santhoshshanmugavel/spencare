import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, GoalRow } from "@spencare/domain-application";
import { EditGoalSheet } from "./edit-goal-sheet";

vi.mock("./actions", () => ({
  updateGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { updateGoalAction } = await import("./actions");
  vi.mocked(updateGoalAction).mockReset();
  vi.mocked(updateGoalAction).mockResolvedValue({ ok: true, value: {} as never });
});

const goal: GoalRow = {
  id: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
  user_id: "u1",
  name: "Vietnam Trip",
  target_amount_minor: 5500000,
  target_date: "2027-07-01",
  funding_account_id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
  saved_amount_minor: 500000,
  status: "active",
  term: "short",
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

const accounts: AccountRow[] = [
  {
    id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
    user_id: "u1",
    type: "bank",
    name: "HDFC Savings",
    currency: "INR",
    balance_minor: 1000000,
    credit_limit_minor: null,
    credit_used_minor: null,
    market_value_minor: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    statement_generated_day: null,
    payment_due_day: null,
  },
  {
    id: "b2f8f6b4-3f0f-4f3a-9c1f-2f6c1c9a1a11",
    user_id: "u1",
    type: "bank",
    name: "ICICI Savings",
    currency: "INR",
    balance_minor: 2000000,
    credit_limit_minor: null,
    credit_used_minor: null,
    market_value_minor: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    statement_generated_day: null,
    payment_due_day: null,
  },
];

describe("<EditGoalSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <EditGoalSheet goal={goal} accounts={accounts} open onOpenChange={() => {}} onUpdated={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<EditGoalSheet goal={goal} accounts={accounts} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<EditGoalSheet> — behavior", () => {
  it("pre-fills the current name, target amount (in rupees), and target date", () => {
    render(<EditGoalSheet goal={goal} accounts={accounts} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByLabelText("Goal name")).toHaveValue("Vietnam Trip");
    expect(screen.getByLabelText("Target amount (INR ₹)")).toHaveValue("55000");
  });

  /**
   * Phase 26: reverses the prior "fixed per goal" decision -- a goal's
   * funding account is now editable from here, pre-selected to the
   * goal's CURRENT account.
   */
  it("shows a funding-account field pre-selected to the goal's current account", () => {
    render(<EditGoalSheet goal={goal} accounts={accounts} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const trigger = screen.getByLabelText("Funding account");
    expect(trigger).toHaveTextContent("HDFC Savings");
  });

  it("submits the updated name and target amount scoped to this goal's id", async () => {
    const { updateGoalAction } = await import("./actions");
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditGoalSheet goal={goal} accounts={accounts} open onOpenChange={() => {}} onUpdated={onUpdated} />);
    const nameInput = screen.getByLabelText("Goal name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Trip");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateGoalAction).toHaveBeenCalledWith(
      goal.id,
      expect.objectContaining({ name: "Renamed Trip", targetAmountMinor: 5500000 }),
    );
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("submits a new fundingAccountId when the user picks a different account", async () => {
    const { updateGoalAction } = await import("./actions");
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditGoalSheet goal={goal} accounts={accounts} open onOpenChange={() => {}} onUpdated={onUpdated} />);
    await user.click(screen.getByLabelText("Funding account"));
    await user.click(await screen.findByRole("option", { name: "ICICI Savings · Bank" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateGoalAction).toHaveBeenCalledWith(
      goal.id,
      expect.objectContaining({ fundingAccountId: "b2f8f6b4-3f0f-4f3a-9c1f-2f6c1c9a1a11" }),
    );
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("still includes the goal's current account in the list even if it were omitted from the eligible-accounts prop", () => {
    render(<EditGoalSheet goal={goal} accounts={[accounts[1]!]} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByLabelText("Funding account")).toHaveTextContent("Current account");
  });
});
