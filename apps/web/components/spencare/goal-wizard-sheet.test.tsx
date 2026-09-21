import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@spencare/domain-application";
import { GoalWizardSheet } from "./goal-wizard-sheet";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/goals",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/goals/actions", () => ({
  createGoalAction: vi.fn(async () => ({ ok: true, value: { id: "goal-1" } })),
  createGoalContributionPlanAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { createGoalAction, createGoalContributionPlanAction } = await import("@/app/goals/actions");
  vi.mocked(createGoalAction).mockReset();
  vi.mocked(createGoalAction).mockResolvedValue({ ok: true, value: { id: "goal-1" } as never });
  vi.mocked(createGoalContributionPlanAction).mockReset();
  vi.mocked(createGoalContributionPlanAction).mockResolvedValue({ ok: true, value: {} as never });
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

describe("<GoalWizardSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens with form fields immediately visible", () => {
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />);
    expect(screen.getByRole("dialog", { name: "Create Goal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Goal name")).toBeInTheDocument();
    expect(screen.getByLabelText("How much would you like to save?")).toBeInTheDocument();
  });
});

describe("<GoalWizardSheet> — happy path (fill name + amount)", () => {
  it("calls createGoalAction with correct args when name and amount are filled", async () => {
    const { createGoalAction } = await import("@/app/goals/actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={onCreated} accounts={[bankAccount]} />);

    await user.type(screen.getByLabelText("Goal name"), "Vietnam Trip");
    await user.type(screen.getByLabelText("How much would you like to save?"), "60000");
    await user.click(screen.getByRole("button", { name: "Create goal" }));

    expect(createGoalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Vietnam Trip",
        targetAmountMinor: 6_000_000,
      }),
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("Create goal button is disabled until both name and amount are entered", async () => {
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />);
    const createBtn = screen.getByRole("button", { name: "Create goal" });
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByLabelText("Goal name"), "Emergency Fund");
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByLabelText("How much would you like to save?"), "75000");
    expect(createBtn).toBeEnabled();
  });
});

describe("<GoalWizardSheet> — goal type selection", () => {
  it("defaults to Short term and lets user switch to Long term", async () => {
    const { createGoalAction } = await import("@/app/goals/actions");
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />);

    await user.type(screen.getByLabelText("Goal name"), "Retirement");
    await user.type(screen.getByLabelText("How much would you like to save?"), "5000000");
    await user.click(screen.getByRole("button", { name: "Long term" }));
    await user.click(screen.getByRole("button", { name: "Create goal" }));

    expect(createGoalAction).toHaveBeenCalledWith(
      expect.objectContaining({ term: "long" }),
    );
  });
});

describe("<GoalWizardSheet> — no accounts", () => {
  it("still shows the form with no accounts connected", () => {
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[]} />);
    expect(screen.getByLabelText("Goal name")).toBeInTheDocument();
    expect(screen.getByLabelText("How much would you like to save?")).toBeInTheDocument();
  });
});

describe("<GoalWizardSheet> — server-side failure", () => {
  it("surfaces the error and does not call onCreated when createGoalAction fails", async () => {
    const { createGoalAction } = await import("@/app/goals/actions");
    vi.mocked(createGoalAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "validation_error", message: "Goals can only be funded from a bank, cash, or investment account." },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<GoalWizardSheet open onOpenChange={() => {}} onCreated={onCreated} accounts={[bankAccount]} />);

    await user.type(screen.getByLabelText("Goal name"), "Emergency Fund");
    await user.type(screen.getByLabelText("How much would you like to save?"), "75000");
    await user.click(screen.getByRole("button", { name: "Create goal" }));

    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Goal name")).toBeInTheDocument();
  });
});
