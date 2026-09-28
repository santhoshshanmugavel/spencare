import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { ArchivePlanDialog } from "./archive-plan-dialog";

vi.mock("../actions", () => ({
  archivePlanAction: vi.fn(async () => ({ ok: true, value: {} })),
  updatePlanStatusAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { archivePlanAction, updatePlanStatusAction } = await import("../actions");
  vi.mocked(archivePlanAction).mockReset();
  vi.mocked(updatePlanStatusAction).mockReset();
  vi.mocked(archivePlanAction).mockResolvedValue({ ok: true, value: {} as never });
  vi.mocked(updatePlanStatusAction).mockResolvedValue({ ok: true, value: {} as never });
});

const plan: FinancialPlanRow = {
  id: "plan-1",
  user_id: "u1",
  name: "Thailand Trip",
  description: null,
  status: "active",
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

describe("<ArchivePlanDialog>", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ArchivePlanDialog plan={plan} open onOpenChange={() => {}} onArchived={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never claims data will be deleted — archiving keeps items, budget, and transactions", () => {
    render(<ArchivePlanDialog plan={plan} open onOpenChange={() => {}} onArchived={() => {}} />);
    expect(screen.getAllByText(/its items, budget, and attached transactions are kept/i).length).toBeGreaterThan(0);
  });

  it("confirming calls archivePlanAction and reports it as undoable", async () => {
    const { archivePlanAction } = await import("../actions");
    const onArchived = vi.fn();
    const user = userEvent.setup();
    render(<ArchivePlanDialog plan={plan} open onOpenChange={() => {}} onArchived={onArchived} />);
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    expect(archivePlanAction).toHaveBeenCalledWith("plan-1");
    expect(await screen.findByRole("status")).toHaveTextContent(/confirmed/i);
  });

  it("cancelling never calls archivePlanAction", async () => {
    const { archivePlanAction } = await import("../actions");
    const user = userEvent.setup();
    render(<ArchivePlanDialog plan={plan} open onOpenChange={() => {}} onArchived={() => {}} />);
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(archivePlanAction).not.toHaveBeenCalled();
  });
});
