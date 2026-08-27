import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@spencare/domain-application";
import { AddGoalSheet } from "./add-goal-sheet";

vi.mock("./actions", () => ({
  createGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { createGoalAction } = await import("./actions");
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
};

describe("<AddGoalSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <AddGoalSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<AddGoalSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />);
    expect(screen.getByRole("button", { name: "Create goal" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<AddGoalSheet> — behavior", () => {
  it("requires a name, target amount, and funding account before submitting", async () => {
    const { createGoalAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddGoalSheet open onOpenChange={() => {}} onCreated={() => {}} accounts={[bankAccount]} />);
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    expect(createGoalAction).not.toHaveBeenCalled();
  });

  it("submits a valid goal without a target date (CF-06 default: optional)", async () => {
    const { createGoalAction } = await import("./actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<AddGoalSheet open onOpenChange={() => {}} onCreated={onCreated} accounts={[bankAccount]} />);
    await user.type(screen.getByLabelText("Goal name"), "Emergency Fund");
    await user.type(screen.getByLabelText("Target amount (INR ₹)"), "100000");
    await user.click(screen.getByRole("combobox", { name: "Funding account" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank" }));
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    expect(createGoalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Emergency Fund",
        targetAmountMinor: 10000000,
        fundingAccountId: bankAccount.id,
      }),
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("surfaces a server-side error without crashing or calling onCreated", async () => {
    const { createGoalAction } = await import("./actions");
    vi.mocked(createGoalAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "validation_error", message: "Goals can only be funded from a bank or cash account." },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<AddGoalSheet open onOpenChange={() => {}} onCreated={onCreated} accounts={[bankAccount]} />);
    await user.type(screen.getByLabelText("Goal name"), "Test");
    await user.type(screen.getByLabelText("Target amount (INR ₹)"), "1000");
    await user.click(screen.getByRole("combobox", { name: "Funding account" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank" }));
    await user.click(screen.getByRole("button", { name: "Create goal" }));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
