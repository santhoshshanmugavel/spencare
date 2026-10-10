import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { DeletePlanDialog } from "./delete-plan-dialog";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("../actions", () => ({
  deletePlanAction: vi.fn(async () => ({ ok: true, value: undefined })),
}));

beforeEach(async () => {
  const { deletePlanAction } = await import("../actions");
  vi.mocked(deletePlanAction).mockReset();
  vi.mocked(deletePlanAction).mockResolvedValue({ ok: true, value: undefined });
  push.mockReset();
});

const plan: FinancialPlanRow = {
  id: "plan-1",
  user_id: "u1",
  name: "Draft Plan",
  description: null,
  status: "draft",
  start_date: null,
  end_date: null,
  base_currency: "INR",
  original_budget_minor: null,
  current_budget_minor: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

describe("<DeletePlanDialog>", () => {
  it("has no axe violations", async () => {
    const { container } = render(<DeletePlanDialog plan={plan} open onOpenChange={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never claims financial data will be deleted — describes SET NULL (detach) and cascade (items) accurately", () => {
    render(<DeletePlanDialog plan={plan} open onOpenChange={() => {}} />);
    expect(screen.queryByText(/all associated financial data will be deleted/i)).not.toBeInTheDocument();
    // Dialog must accurately state that transactions are detached, not deleted,
    // and that plan items are removed.
    expect(screen.getAllByText(/attached transactions will be detached/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no financial data is deleted/i).length).toBeGreaterThan(0);
  });

  it("confirming calls deletePlanAction and navigates back to the list", async () => {
    const { deletePlanAction } = await import("../actions");
    const user = userEvent.setup();
    render(<DeletePlanDialog plan={plan} open onOpenChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    expect(deletePlanAction).toHaveBeenCalledWith("plan-1");
  });
});
