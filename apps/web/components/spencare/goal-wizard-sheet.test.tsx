import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@spencare/domain-application";
import { GoalWizardSheet } from "./goal-wizard-sheet";

vi.mock("@/app/goals/actions", () => ({
  createGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { createGoalAction } = await import("@/app/goals/actions");
  vi.mocked(createGoalAction).mockReset();
  vi.mocked(createGoalAction).mockResolvedValue({ ok: true, value: {} as never });
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
  statement_generated_day: null,
  payment_due_day: null,
};

describe("<GoalWizardSheet> — accessibility", () => {
  it("has no axe violations at the opening question", async () => {
    const { container } = render(
      <GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens by asking a real, visible question rather than a bare form", () => {
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />);
    expect(screen.getByText("What are you saving for?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emergency Fund" })).toBeInTheDocument();
  });
});

describe("<GoalWizardSheet> — the full conversational happy path (Vietnam trip, matches Goal Creation.pdf)", () => {
  it("walks category -> trip band -> name -> amount -> savings -> date -> account -> summary -> create", async () => {
    const { createGoalAction } = await import("@/app/goals/actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={onCreated} accounts={[bankAccount]} />);

    await user.click(screen.getByRole("button", { name: "Trip" }));
    expect(screen.getByText("Nice. Where are you planning to go?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "International" }));
    expect(screen.getByText("What should we call this trip?")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Goal name"), "Vietnam Trip");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Trips abroad usually cost/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "₹60,000" }));
    expect(screen.getByText("Do you already have some savings for this?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "₹0" }));
    expect(screen.getByText(/When are you planning to reach this goal\?/)).toBeInTheDocument();

    const dateChip = screen.getAllByRole("button").find((b) => /^[A-Z][a-z]{2} \d{4}$/.test(b.textContent ?? ""));
    expect(dateChip).toBeDefined();
    await user.click(dateChip!);
    expect(screen.getByText("Where should we save money for this goal?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "HDFC Bank" }));
    expect(screen.getAllByText("Vietnam Trip").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Create Goal" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create Goal" }));

    expect(createGoalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Vietnam Trip",
        targetAmountMinor: 6_000_000,
        fundingAccountId: bankAccount.id,
        initialSavedAmountMinor: 0,
      }),
    );
    expect(await screen.findByRole("button", { name: "View goal" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View goal" }));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});

describe("<GoalWizardSheet> — Emergency Fund (no destination sub-step, name auto-filled)", () => {
  it("skips straight to the amount question", async () => {
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />);
    await user.click(screen.getByRole("button", { name: "Emergency Fund" }));
    expect(screen.getByText(/common starting point is 3–6 months/)).toBeInTheDocument();
  });
});

describe("<GoalWizardSheet> — Adjust Plan", () => {
  it("returns to the amount question and re-asks savings/date/account", async () => {
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />);
    await user.click(screen.getByRole("button", { name: "Vehicle" }));
    await user.type(screen.getByLabelText("Goal name"), "Royal Enfield");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "₹1,50,000" }));
    await user.click(screen.getByRole("button", { name: "₹0" }));
    const dateChip = screen.getAllByRole("button").find((b) => /^[A-Z][a-z]{2} \d{4}$/.test(b.textContent ?? ""));
    await user.click(dateChip!);
    await user.click(screen.getByRole("button", { name: "HDFC Bank" }));
    expect(screen.getByRole("button", { name: "Create Goal" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Adjust Plan" }));
    expect(screen.getByText(/Vehicle costs vary/)).toBeInTheDocument();
  });
});

describe("<GoalWizardSheet> — no eligible accounts (matches New Goal-1.pdf's branch)", () => {
  it("offers to connect an account instead of a dead-end funding-account question", async () => {
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[]} />);
    await user.click(screen.getByRole("button", { name: "Emergency Fund" }));
    await user.click(screen.getByRole("button", { name: "₹75,000" }));
    await user.click(screen.getByRole("button", { name: "₹0" }));
    const dateChip = screen.getAllByRole("button").find((b) => /^[A-Z][a-z]{2} \d{4}$/.test(b.textContent ?? ""));
    await user.click(dateChip!);
    expect(screen.getByRole("link", { name: "Setup account" })).toHaveAttribute("href", "/settings/accounts");
  });
});

describe("<GoalWizardSheet> — server-side failure", () => {
  it("surfaces the error and stays on the summary step rather than showing a false success", async () => {
    const { createGoalAction } = await import("@/app/goals/actions");
    vi.mocked(createGoalAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "validation_error", message: "Goals can only be funded from a bank, cash, or investment account." },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={onCreated} accounts={[bankAccount]} />);
    await user.click(screen.getByRole("button", { name: "Emergency Fund" }));
    await user.click(screen.getByRole("button", { name: "₹75,000" }));
    await user.click(screen.getByRole("button", { name: "₹0" }));
    const dateChip = screen.getAllByRole("button").find((b) => /^[A-Z][a-z]{2} \d{4}$/.test(b.textContent ?? ""));
    await user.click(dateChip!);
    await user.click(screen.getByRole("button", { name: "HDFC Bank" }));
    await user.click(screen.getByRole("button", { name: "Create Goal" }));
    expect(screen.queryByRole("button", { name: "View goal" })).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
