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
  statement_generated_day: null,
  payment_due_day: null,
};

const investmentAccount: AccountRow = {
  ...account,
  id: "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d",
  type: "investment",
  name: "Mutual Fund",
  balance_minor: 0,
  market_value_minor: 30_000_000,
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

describe("<GoalsGrid> — empty state", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <GoalsGrid initialGoals={[]} accounts={[account]} fundingEligibleAccounts={[account]} contributionEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an honest empty state, not a fabricated goal", () => {
    render(<GoalsGrid initialGoals={[]} accounts={[account]} fundingEligibleAccounts={[account]} contributionEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument();
  });

  it("Create goal stays enabled with no eligible funding account -- the wizard itself offers to connect one mid-conversation (New Goal-1.pdf), never a silently disabled entry point", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[]} accounts={[]} fundingEligibleAccounts={[]} contributionEligibleAccounts={[]} masked={false} imageSignedUrls={{}} />);
    const button = screen.getByRole("button", { name: "+ Create goal" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(screen.getByText("What are you saving for?")).toBeInTheDocument();
  });
});

describe("<GoalsGrid> — populated", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} contributionEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens Edit Goal from the card's actions menu, not the view-detail dialog too (no unintended double-open)", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} contributionEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    await user.click(screen.getByRole("button", { name: `Actions for ${goal.name}` }));
    await user.click(screen.getByRole("menuitem", { name: "Edit Goal" }));
    expect(screen.getByRole("heading", { name: `Edit ${goal.name}` })).toBeInTheDocument();
    // The detail dialog must NOT also be open.
    expect(screen.queryByText("Contributions")).not.toBeInTheDocument();
  });

  it("opens the detail dialog when the card's name is clicked (the image area is now a real upload target, not a detail-view trigger -- Phase 26)", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} contributionEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    await user.click(screen.getByRole("button", { name: goal.name }));
    expect(await screen.findByText("Contributions")).toBeInTheDocument();
  });

  it("opens the Contribute sheet from the card's persistent Add Cash button", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} contributionEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    await user.click(screen.getByRole("button", { name: "Add Cash" }));
    expect(screen.getByRole("heading", { name: `Add cash to ${goal.name}` })).toBeInTheDocument();
  });

  it("opens Create goal from the header button", async () => {
    const user = userEvent.setup();
    render(<GoalsGrid initialGoals={[goal]} accounts={[account]} fundingEligibleAccounts={[account]} contributionEligibleAccounts={[account]} masked={false} imageSignedUrls={{}} />);
    await user.click(screen.getByRole("button", { name: "+ Create goal" }));
    expect(screen.getByRole("heading", { name: "Create a goal with Spensa" })).toBeInTheDocument();
  });
});

describe("<GoalsGrid> — Short term / Long term filter (Goals-9.pdf)", () => {
  const longTermGoal: GoalRow = { ...goal, id: "b2f8f6b4-3f0f-4f3a-9c1f-2f6c1c9a1a11", name: "Bali Trip 2027", term: "long" };

  it("shows only short-term goals by default and hides long-term ones", () => {
    render(
      <GoalsGrid
        initialGoals={[goal, longTermGoal]}
        accounts={[account]}
        fundingEligibleAccounts={[account]}
        contributionEligibleAccounts={[account]}
        masked={false}
        imageSignedUrls={{}}
      />,
    );
    expect(screen.getByRole("button", { name: goal.name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: longTermGoal.name })).not.toBeInTheDocument();
  });

  it("switches to long-term goals when the Long term tab is selected", async () => {
    const user = userEvent.setup();
    render(
      <GoalsGrid
        initialGoals={[goal, longTermGoal]}
        accounts={[account]}
        fundingEligibleAccounts={[account]}
        contributionEligibleAccounts={[account]}
        masked={false}
        imageSignedUrls={{}}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Long term" }));
    expect(screen.getByRole("button", { name: longTermGoal.name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: goal.name })).not.toBeInTheDocument();
  });

  it("search narrows the active term tab by goal name", async () => {
    const secondShortTermGoal: GoalRow = { ...goal, id: "c3f9f7c5-4f1f-5f4b-ad2f-3f7d2d0b2b22", name: "Emergency Fund" };
    const user = userEvent.setup();
    render(
      <GoalsGrid
        initialGoals={[goal, secondShortTermGoal]}
        accounts={[account]}
        fundingEligibleAccounts={[account]}
        contributionEligibleAccounts={[account]}
        masked={false}
        imageSignedUrls={{}}
      />,
    );
    await user.type(screen.getByRole("searchbox", { name: "Search goals" }), "emergency");
    expect(screen.getByRole("button", { name: "Emergency Fund" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: goal.name })).not.toBeInTheDocument();
  });
});

describe("<GoalsGrid> — Phase 28: funding vs. contribution account eligibility are separate lists", () => {
  it("Create goal offers Investment as a funding account", async () => {
    const user = userEvent.setup();
    render(
      <GoalsGrid
        initialGoals={[goal]}
        accounts={[account, investmentAccount]}
        fundingEligibleAccounts={[account, investmentAccount]}
        contributionEligibleAccounts={[account]}
        masked={false}
        imageSignedUrls={{}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ Create goal" }));
    await user.click(screen.getByRole("button", { name: "Emergency Fund" }));
    await user.click(screen.getByRole("button", { name: "₹75,000" }));
    await user.click(screen.getByRole("button", { name: "₹0" }));
    const dateChip = screen.getAllByRole("button").find((b) => /^[A-Z][a-z]{2} \d{4}$/.test(b.textContent ?? ""));
    await user.click(dateChip!);
    expect(screen.getByText("Where should we save money for this goal?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mutual Fund" })).toBeInTheDocument();
  });

  it("Add Cash (a real contribution) never offers Investment -- no fabricated investment-accounting operation exists", async () => {
    const user = userEvent.setup();
    render(
      <GoalsGrid
        initialGoals={[goal]}
        accounts={[account, investmentAccount]}
        fundingEligibleAccounts={[account, investmentAccount]}
        contributionEligibleAccounts={[account]}
        masked={false}
        imageSignedUrls={{}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add Cash" }));
    await user.click(screen.getByRole("combobox", { name: "From account" }));
    expect(screen.queryByRole("option", { name: /Mutual Fund/ })).not.toBeInTheDocument();
  });
});
