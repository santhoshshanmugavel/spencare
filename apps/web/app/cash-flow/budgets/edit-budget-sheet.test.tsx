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
};

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

  it("submits only amountMinor, scoped to this budget's id -- category and month are not resubmitted", async () => {
    const { updateBudgetAction } = await import("./actions");
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditBudgetSheet budget={budget} categoryName="Dining" open onOpenChange={() => {}} onUpdated={onUpdated} />);
    const input = screen.getByLabelText("Monthly limit (INR ₹)");
    await user.clear(input);
    await user.type(input, "8000");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateBudgetAction).toHaveBeenCalledWith("budget-1", { amountMinor: 800000 });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });
});
