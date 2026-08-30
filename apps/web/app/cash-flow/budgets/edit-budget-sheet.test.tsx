import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetWithUsage } from "@spencare/domain-application";
import { EditBudgetSheet } from "./edit-budget-sheet";

vi.mock("./actions", () => ({
  updateBudgetAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { updateBudgetAction } = await import("./actions");
  vi.mocked(updateBudgetAction).mockReset();
  vi.mocked(updateBudgetAction).mockResolvedValue({ ok: true, value: {} as never });
});

const budget: BudgetWithUsage = {
  id: "budget-1",
  categoryId: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  limitMinor: 600000,
  spentMinor: 470000,
  remainingMinor: 130000,
  percentUsed: 78.33,
  status: "near_limit",
  isRecurring: false,
};

const recurringBudget: BudgetWithUsage = { ...budget, id: "budget-2", isRecurring: true };

describe("<EditBudgetSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<EditBudgetSheet> — behavior", () => {
  it("pre-fills the current limit in rupees", () => {
    render(<EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByLabelText("Monthly limit (INR ₹)")).toHaveValue("6000");
  });

  it("defaults 'Apply to' to This month only for a non-recurring budget", () => {
    render(<EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByRole("radio", { name: "This month only" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "This month and upcoming months" })).not.toBeChecked();
  });

  it("defaults 'Apply to' to This month and upcoming months for a budget already part of a recurring plan", () => {
    render(<EditBudgetSheet budget={recurringBudget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByRole("radio", { name: "This month and upcoming months" })).toBeChecked();
  });

  it("'This month only' submits directly, with no confirmation dialog", async () => {
    const { updateBudgetAction } = await import("./actions");
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={onUpdated} />);
    const input = screen.getByLabelText("Monthly limit (INR ₹)");
    await user.clear(input);
    await user.type(input, "8000");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.queryByText("Apply to upcoming months?")).not.toBeInTheDocument();
    expect(updateBudgetAction).toHaveBeenCalledWith("budget-1", { amountMinor: 800000, applyToUpcoming: false });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("'This month and upcoming months' shows the confirmation dialog with the mandate's exact copy before submitting anything", async () => {
    const { updateBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={() => {}} />);
    await user.click(screen.getByRole("radio", { name: "This month and upcoming months" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Apply to upcoming months?")).toBeInTheDocument();
    expect(
      screen.getByText("Your changes will replace the current budget plan for August 2026 and all upcoming months. Previous months won't be changed."),
    ).toBeInTheDocument();
    expect(updateBudgetAction).not.toHaveBeenCalled();
  });

  it("confirming the dialog submits with applyToUpcoming: true", async () => {
    const { updateBudgetAction } = await import("./actions");
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={onUpdated} />);
    await user.click(screen.getByRole("radio", { name: "This month and upcoming months" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(updateBudgetAction).toHaveBeenCalledWith("budget-1", { amountMinor: 600000, applyToUpcoming: true });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("cancelling the dialog submits nothing and returns to the form", async () => {
    const { updateBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={() => {}} />);
    await user.click(screen.getByRole("radio", { name: "This month and upcoming months" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateBudgetAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Apply to upcoming months?")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Monthly limit (INR ₹)")).toBeInTheDocument(); // form still present
  });
});
