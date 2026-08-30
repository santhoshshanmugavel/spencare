import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { AccountRow, GoalRow } from "@spencare/domain-application";
import { GoalsGrid } from "./goals-grid";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("./actions", () => ({
  createGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
  updateGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
  archiveGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
  restoreGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
  deleteGoalAction: vi.fn(async () => ({ ok: true, value: undefined })),
  addContributionAction: vi.fn(async () => ({ ok: true, value: {} })),
  withdrawContributionAction: vi.fn(async () => ({ ok: true, value: {} })),
  listContributionsAction: vi.fn(async () => []),
  updateGoalImageAction: vi.fn(async () => ({ ok: true, value: { signedUrl: "https://signed.example/new.png" } })),
  removeGoalImageAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

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

describe("<GoalsGrid> — empty state", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <GoalsGrid initialGoals={[]} accounts={[account]} fundingEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an honest empty state, not a fabricated goal", () => {
    render(<GoalsGrid initialGoals={[]} accounts={[account]} fundingEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument();
  });

  it("disables Create goal when there is no eligible funding account", () => {
    render(<GoalsGrid initialGoals={[]} accounts={[]} fundingEligibleAccounts={[]} masked={false} imageSignedUrls={{}} />);
    expect(screen.getByRole("button", { name: "+ Create goal" })).toBeDisabled();
  });
});

describe("<GoalsGrid> — populated", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens Edit Goal from the card's actions menu, not the view-detail dialog too (no unintended double-open)", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    await user.click(screen.getByRole("button", { name: `Actions for ${goal.name}` }));
    await user.click(screen.getByRole("menuitem", { name: "Edit Goal" }));
    expect(screen.getByRole("heading", { name: `Edit ${goal.name}` })).toBeInTheDocument();
    // The detail dialog must NOT also be open.
    expect(screen.queryByText("Contributions")).not.toBeInTheDocument();
  });

  it("opens the detail dialog when the card's name is clicked (the image area is now a real upload target, not a detail-view trigger -- Phase 26)", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    await user.click(screen.getByRole("button", { name: goal.name }));
    expect(await screen.findByText("Contributions")).toBeInTheDocument();
  });

  it("opens the Contribute sheet from the card's persistent Add Cash button", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    await user.click(screen.getByRole("button", { name: "Add Cash" }));
    expect(screen.getByRole("heading", { name: `Add cash to ${goal.name}` })).toBeInTheDocument();
  });

  it("opens Create goal from the header button", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    await user.click(screen.getByRole("button", { name: "+ Create goal" }));
    expect(screen.getByRole("heading", { name: "Create goal" })).toBeInTheDocument();
  });
});
