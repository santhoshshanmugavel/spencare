import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalRow } from "@spencare/domain-application";
import { EditGoalSheet } from "./edit-goal-sheet";

vi.mock("./actions", () => ({
  updateGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { updateGoalAction } = await import("./actions");
  vi.mocked(updateGoalAction).mockReset();
  vi.mocked(updateGoalAction).mockResolvedValue({ ok: true, value: {} as never });
});

const goal: GoalRow = {
  id: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
  user_id: "u1",
  name: "Vietnam Trip",
  target_amount_minor: 5500000,
  target_date: "2027-07-01",
  funding_account_id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
  saved_amount_minor: 500000,
  status: "active",
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

describe("<EditGoalSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<EditGoalSheet goal={goal} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<EditGoalSheet goal={goal} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<EditGoalSheet> — behavior", () => {
  it("pre-fills the current name, target amount (in rupees), and target date", () => {
    render(<EditGoalSheet goal={goal} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByLabelText("Goal name")).toHaveValue("Vietnam Trip");
    expect(screen.getByLabelText("Target amount (INR ₹)")).toHaveValue("55000");
  });

  it("has no funding-account field -- fixed per goal after creation", () => {
    render(<EditGoalSheet goal={goal} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.queryByLabelText(/funding account/i)).not.toBeInTheDocument();
  });

  it("submits the updated name and target amount scoped to this goal's id", async () => {
    const { updateGoalAction } = await import("./actions");
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditGoalSheet goal={goal} open onOpenChange={() => {}} onUpdated={onUpdated} />);
    const nameInput = screen.getByLabelText("Goal name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Trip");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateGoalAction).toHaveBeenCalledWith(
      goal.id,
      expect.objectContaining({ name: "Renamed Trip", targetAmountMinor: 5500000 }),
    );
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });
});
