import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { PlanBudgetSheet } from "./plan-budget-sheet";

vi.mock("../actions", () => ({
  updatePlanBudgetAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { updatePlanBudgetAction } = await import("../actions");
  vi.mocked(updatePlanBudgetAction).mockReset();
  vi.mocked(updatePlanBudgetAction).mockResolvedValue({ ok: true, value: {} as never });
});

function plan(overrides: Partial<FinancialPlanRow> = {}): FinancialPlanRow {
  return {
    id: "plan-1",
    user_id: "u1",
    name: "Thailand Trip",
    description: null,
    status: "active",
    start_date: null,
    end_date: null,
    base_currency: "INR",
    original_budget_minor: 10000000,
    current_budget_minor: 10000000,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    archived_at: null,
    ...overrides,
  };
}

describe("<PlanBudgetSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<PlanBudgetSheet> — behavior", () => {
  it("pre-fills the current budget in major units", () => {
    render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByLabelText(/Total budget/)).toHaveValue("100000");
  });

  it("saves a new budget amount converted to minor units", async () => {
    const { updatePlanBudgetAction } = await import("../actions");
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={onUpdated} />);
    const input = screen.getByLabelText(/Total budget/);
    await user.clear(input);
    await user.type(input, "50000");
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(updatePlanBudgetAction).toHaveBeenCalledWith("plan-1", { budgetMinor: 5000000 });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("allows reducing the budget below actual spend without any warning or block (Gate 4 spec)", async () => {
    const { updatePlanBudgetAction } = await import("../actions");
    const user = userEvent.setup();
    // A budget lower than whatever has already been spent is a legitimate, unblocked edit --
    // this form has no knowledge of actual spend at all, by design (it only sets the limit).
    render(<PlanBudgetSheet plan={plan({ current_budget_minor: 10000000 })} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const input = screen.getByLabelText(/Total budget/);
    await user.clear(input);
    await user.type(input, "100");
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(updatePlanBudgetAction).toHaveBeenCalledWith("plan-1", { budgetMinor: 10000 });
  });

  it("clearing the field removes the budget (null, never a fake zero)", async () => {
    const { updatePlanBudgetAction } = await import("../actions");
    const user = userEvent.setup();
    render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const input = screen.getByLabelText(/Total budget/);
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(updatePlanBudgetAction).toHaveBeenCalledWith("plan-1", { budgetMinor: null });
  });

  it("shows an inline error for malformed input and never calls the action", async () => {
    const { updatePlanBudgetAction } = await import("../actions");
    const user = userEvent.setup();
    render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const input = screen.getByLabelText(/Total budget/);
    await user.clear(input);
    await user.type(input, "abc");
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(await screen.findByText("Invalid amount.")).toBeInTheDocument();
    expect(updatePlanBudgetAction).not.toHaveBeenCalled();
  });

  it("rejects a negative amount rather than silently saving a negative budget", async () => {
    const { updatePlanBudgetAction } = await import("../actions");
    const user = userEvent.setup();
    render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const input = screen.getByLabelText(/Total budget/);
    await user.clear(input);
    await user.type(input, "-500");
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(await screen.findByText("Invalid amount.")).toBeInTheDocument();
    expect(updatePlanBudgetAction).not.toHaveBeenCalled();
  });

  it("accepts Indian-grouped input with two decimal places (₹1,00,000.50) using integer minor units, never floating point", async () => {
    const { updatePlanBudgetAction } = await import("../actions");
    const user = userEvent.setup();
    render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const input = screen.getByLabelText(/Total budget/);
    await user.clear(input);
    await user.type(input, "1,00,000.50");
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(updatePlanBudgetAction).toHaveBeenCalledWith("plan-1", { budgetMinor: 10000050 });
  });

  it("disables the submit button while a save is in flight, preventing a duplicate submission", async () => {
    const { updatePlanBudgetAction } = await import("../actions");
    let resolveAction: (value: Awaited<ReturnType<typeof updatePlanBudgetAction>>) => void = () => {};
    vi.mocked(updatePlanBudgetAction).mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const button = screen.getByRole("button", { name: "Save budget" });
    await user.click(button);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(updatePlanBudgetAction).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Saving…" }));
    expect(updatePlanBudgetAction).toHaveBeenCalledTimes(1);
    resolveAction({ ok: true, value: {} as never });
  });

  it("rejects more decimal places than INR supports (2)", async () => {
    const { updatePlanBudgetAction } = await import("../actions");
    const user = userEvent.setup();
    render(<PlanBudgetSheet plan={plan()} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const input = screen.getByLabelText(/Total budget/);
    await user.clear(input);
    await user.type(input, "18.999");
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(await screen.findByText(/at most 2 decimal places/i)).toBeInTheDocument();
    expect(updatePlanBudgetAction).not.toHaveBeenCalled();
  });
});
