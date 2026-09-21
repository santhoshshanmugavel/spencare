import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, GoalRow } from "@spencare/domain-application";
import { ContributeSheet } from "./contribute-sheet";

vi.mock("./actions", () => ({
  addContributionAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { addContributionAction } = await import("./actions");
  vi.mocked(addContributionAction).mockReset();
  vi.mocked(addContributionAction).mockResolvedValue({ ok: true, value: {} as never });
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
  saved_amount_minor: 0,
  status: "active",
  term: "short",
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

describe("<ContributeSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <ContributeSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onContributed={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<ContributeSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onContributed={() => {}} />);
    expect(screen.getByRole("button", { name: "Add cash" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<ContributeSheet> — behavior", () => {
  it("defaults the account to the goal's own funding account (CF-08: default/suggested, not an enforced constraint)", () => {
    render(<ContributeSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onContributed={() => {}} />);
    expect(screen.getByRole("combobox", { name: "From account" })).toHaveTextContent("HDFC Bank");
  });

  it("requires a positive amount before submitting", async () => {
    const { addContributionAction } = await import("./actions");
    const user = userEvent.setup();
    render(<ContributeSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onContributed={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Add cash" }));
    expect(addContributionAction).not.toHaveBeenCalled();
  });

  it("submits a valid contribution scoped to this goal", async () => {
    const { addContributionAction } = await import("./actions");
    const onContributed = vi.fn();
    const user = userEvent.setup();
    render(
      <ContributeSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onContributed={onContributed} />,
    );
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "5000");
    await user.click(screen.getByRole("button", { name: "Add cash" }));
    expect(addContributionAction).toHaveBeenCalledWith({
      goalId: goal.id,
      accountId: bankAccount.id,
      amountMinor: 500000,
    });
    expect(onContributed).toHaveBeenCalledTimes(1);
  });

  it("surfaces a server-side error (e.g. an ineligible account) without crashing", async () => {
    const { addContributionAction } = await import("./actions");
    vi.mocked(addContributionAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "contribution_failed", message: "That account can't be used for this goal." },
    });
    const onContributed = vi.fn();
    const user = userEvent.setup();
    render(
      <ContributeSheet goal={goal} accounts={[bankAccount]} open onOpenChange={() => {}} onContributed={onContributed} />,
    );
    await user.type(screen.getByLabelText("Amount (INR ₹)"), "5000");
    await user.click(screen.getByRole("button", { name: "Add cash" }));
    expect(onContributed).not.toHaveBeenCalled();
  });
});
