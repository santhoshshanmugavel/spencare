import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, GoalRow, TransactionRow } from "@spencare/domain-application";
import { GoalDetailDialog } from "./goal-detail-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/goals",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  listContributionsAction: vi.fn(async () => []),
  updateGoalImageAction: vi.fn(async () => ({ ok: true, value: { signedUrl: "https://signed.example/new.png" } })),
  removeGoalImageAction: vi.fn(async () => ({ ok: true, value: {} })),
  getGoalContributionPlanAction: vi.fn(async () => null),
}));
vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

beforeEach(async () => {
  const { listContributionsAction, updateGoalImageAction, removeGoalImageAction } = await import("./actions");
  vi.mocked(listContributionsAction).mockReset();
  vi.mocked(listContributionsAction).mockResolvedValue([]);
  vi.mocked(updateGoalImageAction).mockReset();
  vi.mocked(updateGoalImageAction).mockResolvedValue({
    ok: true,
    value: { signedUrl: "https://signed.example/new.png" } as never,
  });
  vi.mocked(removeGoalImageAction).mockReset();
  vi.mocked(removeGoalImageAction).mockResolvedValue({ ok: true, value: {} as never });
  const { toastConfirmed, toastError } = await import("@/lib/toast");
  vi.mocked(toastConfirmed).mockReset();
  vi.mocked(toastError).mockReset();
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
  statement_close_day: null,
  payment_due_day: null,
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
  term: "short",
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
  item_name: null,
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
        imageSignedUrl={null}
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
        imageSignedUrl={null}
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
    await screen.findByText("Manual");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<GoalDetailDialog> — content and behavior", () => {
  it("shows saved/target amounts and the progress bar", async () => {
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl={null}
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
        imageSignedUrl={null}
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

  it("shows a real, grounded insight sentence for a goal with a target date (Phase 34 §11 — Goals-6.pdf's insight box)", async () => {
    const scheduledGoal = { ...goal, target_date: "2027-03-01", saved_amount_minor: 3000000, target_amount_minor: 5300000, created_at: "2026-01-01T00:00:00Z" };
    render(
      <GoalDetailDialog
        goal={scheduledGoal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    expect(screen.getByText(/₹30,000 saved so far/)).toBeInTheDocument();
    expect(screen.getByText(/will get you there by Mar 2027/)).toBeInTheDocument();
  });

  it("never claims a pace for a goal with no target date, rather than fabricating one", async () => {
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    expect(screen.queryByText(/on track|behind pace/)).not.toBeInTheDocument();
    expect(screen.getByText(/saved.*toward your.*goal so far/)).toBeInTheDocument();
  });

  it("hides the insight sentence entirely under Privacy Mode rather than leaking its embedded rupee figures", async () => {
    const scheduledGoal = { ...goal, target_date: "2027-03-01", saved_amount_minor: 3000000 };
    render(
      <GoalDetailDialog
        goal={scheduledGoal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    expect(screen.getByText("Goal insight hidden while Privacy Mode is on.")).toBeInTheDocument();
    expect(screen.queryByText(/₹30,000/)).not.toBeInTheDocument();
  });

  it("renders the reached/celebratory treatment when saved >= target", async () => {
    const reachedGoal = { ...goal, saved_amount_minor: 5500000 };
    render(
      <GoalDetailDialog
        goal={reachedGoal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    expect(screen.getByText(/you're all set/i)).toBeInTheDocument();
  });

  it("shows 'Completed in N months' once the goal has a completed_at timestamp", async () => {
    const completedGoal = {
      ...goal,
      saved_amount_minor: 5500000,
      created_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-06-15T00:00:00Z",
    };
    render(
      <GoalDetailDialog
        goal={completedGoal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    expect(screen.getByText(/completed in 5 months/i)).toBeInTheDocument();
  });

  it("calls onContribute when 'Add Cash' is clicked", async () => {
    const onContribute = vi.fn();
    const user = userEvent.setup();
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    await user.click(screen.getByRole("button", { name: "Add Cash" }));
    expect(onContribute).toHaveBeenCalledTimes(1);
  });

  it("the More menu offers Withdraw/Archive/Delete; Edit Goal is a direct button", async () => {
    const user = userEvent.setup();
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    expect(screen.getByRole("button", { name: "Edit Goal" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `More actions for ${goal.name}` }));
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
        imageSignedUrl={null}
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

describe("<GoalDetailDialog> — goal image (Phase 26)", () => {
  it("shows the no-image fallback (goal name) and an 'Add image' control when there's no image", () => {
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    expect(screen.getByRole("button", { name: `Add an image for ${goal.name}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Remove ${goal.name}'s image` })).not.toBeInTheDocument();
  });

  it("shows the actual image and Replace/Remove controls when one is already set", () => {
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl="https://signed.example/existing.png"
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
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://signed.example/existing.png");
    expect(screen.getByRole("button", { name: `Replace ${goal.name}'s image` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Remove ${goal.name}'s image` })).toBeInTheDocument();
  });

  it("uploads a new image and switches to the returned signed URL", async () => {
    const { updateGoalImageAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl={null}
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
    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    const input = screen.getByLabelText(`Upload an image for ${goal.name}`);
    await user.upload(input, file);
    expect(updateGoalImageAction).toHaveBeenCalledWith(goal.id, expect.any(FormData));
    expect(await screen.findByRole("img")).toHaveAttribute("src", "https://signed.example/new.png");
  });

  it("removes the image and reverts to the no-image fallback", async () => {
    const { removeGoalImageAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl="https://signed.example/existing.png"
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
    await user.click(screen.getByRole("button", { name: `Remove ${goal.name}'s image` }));
    expect(removeGoalImageAction).toHaveBeenCalledWith(goal.id);
    expect(await screen.findByRole("button", { name: `Add an image for ${goal.name}` })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows an error toast and keeps the previous image when the upload fails (no optimistic update)", async () => {
    const { updateGoalImageAction } = await import("./actions");
    vi.mocked(updateGoalImageAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "invalid_file_content", message: "That file doesn't look like a valid PNG, JPEG, or WebP image." },
    });
    const user = userEvent.setup();
    render(
      <GoalDetailDialog
        goal={goal}
        fundingAccount={account}
        imageSignedUrl="https://signed.example/existing.png"
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
    // Declared as a PNG (so the browser's own `accept` filter lets it
    // through) but the actual bytes are plain text -- exactly the case
    // content-sniffing exists to catch: never trust a declared MIME type
    // or filename extension alone.
    const file = new File(["not-really-a-png"], "fake.png", { type: "image/png" });
    const input = screen.getByLabelText(`Upload an image for ${goal.name}`);
    await user.upload(input, file);
    const { toastError } = await import("@/lib/toast");
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("That file doesn't look like a valid PNG, JPEG, or WebP image."),
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://signed.example/existing.png");
  });
});
