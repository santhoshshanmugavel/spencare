import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, GoalRow, TransactionRow } from "@spencare/domain-application";
import { GoalDetailDialog } from "./goal-detail-dialog";

vi.mock("./actions", () => ({
  listContributionsAction: vi.fn(async () => []),
}));

beforeEach(async () => {
  const { listContributionsAction } = await import("./actions");
  vi.mocked(listContributionsAction).mockReset();
  vi.mocked(listContributionsAction).mockResolvedValue([]);
});

const account: AccountRow = {
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
};

const goal: GoalRow = {
  id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
  user_id: "u1",
  name: "Vietnam Trip",
  target_amount_minor: 5500000,
  target_date: null,
  funding_account_id: account.id,
  saved_amount_minor: 500000,
  status: "active",
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

const contribution: TransactionRow = {
  id: "txn-1",
  user_id: "u1",
  account_id: account.id,
  type: "goal_contribution",
  amount_minor: 500000,
  currency: "INR",
  category_id: null,
  merchant: null,
  description: null,
  occurred_at: "2026-08-25",
  status: "posted",
  transfer_pair_id: null,
  goal_id: goal.id,
  bill_prediction_id: null,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
};

const noop = () => {};

describe("<GoalDetailDialog> — accessibility", () => {
  it("has no axe violations (empty contributions)", async () => {
    const { container } = render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        masked={false}
        open
        onOpenChange={noop}
        onContribute={noop}
        onWithdraw={noop}
        onEdit={noop}
        onArchive={noop}
        onDelete={noop}
      />,
    );
    expect(await screen.findByText("No contributions yet.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with a populated contributions ledger", async () => {
    const { listContributionsAction } = await import("./actions");
    vi.mocked(listContributionsAction).mockResolvedValueOnce([contribution]);
    const { container } = render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        masked={false}
        open
        onOpenChange={noop}
        onContribute={noop}
        onWithdraw={noop}
        onEdit={noop}
        onArchive={noop}
        onDelete={noop}
      />,
    );
    await screen.findByText("Contribution");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<GoalDetailDialog> — content and behavior", () => {
  it("shows saved/target amounts and the progress bar", async () => {
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        masked={false}
        open
        onOpenChange={noop}
        onContribute={noop}
        onWithdraw={noop}
        onEdit={noop}
        onArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("masks saved/target figures under Privacy Mode", async () => {
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        masked
        open
        onOpenChange={noop}
        onContribute={noop}
        onWithdraw={noop}
        onEdit={noop}
        onArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getAllByText("₹***").length).toBeGreaterThan(0);
  });

  it("renders the reached/celebratory treatment when saved >= target", async () => {
    const reachedGoal = { ...goal, saved_amount_minor: 5500000 };
    render(
      <GoalDetailDialog
        goal={reachedGoal}
        fundingAccount={account}
        masked={false}
        open
        onOpenChange={noop}
        onContribute={noop}
        onWithdraw={noop}
        onEdit={noop}
        onArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByText(/goal achieved/i)).toBeInTheDocument();
  });

  it("calls onContribute when 'Save more' is clicked", async () => {
    const onContribute = vi.fn();
    const user = userEvent.setup();
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        masked={false}
        open
        onOpenChange={noop}
        onContribute={onContribute}
        onWithdraw={noop}
        onEdit={noop}
        onArchive={noop}
        onDelete={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save more" }));
    expect(onContribute).toHaveBeenCalledTimes(1);
  });

  it("the More menu offers Edit/Withdraw/Archive/Delete", async () => {
    const user = userEvent.setup();
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        masked={false}
        open
        onOpenChange={noop}
        onContribute={noop}
        onWithdraw={noop}
        onEdit={noop}
        onArchive={noop}
        onDelete={noop}
      />,
    );
    await user.click(screen.getByRole("button", { name: `More actions for ${goal.name}` }));
    expect(screen.getByRole("menuitem", { name: "Edit Goal" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Archive Goal" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete Goal" })).toBeInTheDocument();
  });

  it("renders a signed contribution row with a '+' and a withdrawal row without one", async () => {
    const withdrawal: TransactionRow = { ...contribution, id: "txn-2", type: "goal_withdrawal", amount_minor: 100000 };
    const { listContributionsAction } = await import("./actions");
    vi.mocked(listContributionsAction).mockResolvedValueOnce([contribution, withdrawal]);
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        masked={false}
        open
        onOpenChange={noop}
        onContribute={noop}
        onWithdraw={noop}
        onEdit={noop}
        onArchive={noop}
        onDelete={noop}
      />,
    );
    expect(await screen.findByText("+₹5,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹1,000.00")).toBeInTheDocument();
    expect(screen.getByText("Withdraw")).toBeInTheDocument();
  });
});
