import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetWithUsage } from "@spencare/domain-application";
import { DeleteBudgetDialog } from "./delete-budget-dialog";

vi.mock("./actions", () => ({
  deleteBudgetAction: vi.fn(async () => ({ ok: true, value: undefined })),
  createBudgetAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { deleteBudgetAction, createBudgetAction } = await import("./actions");
  vi.mocked(deleteBudgetAction).mockReset();
  vi.mocked(deleteBudgetAction).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(createBudgetAction).mockReset();
  vi.mocked(createBudgetAction).mockResolvedValue({ ok: true, value: {} as never });
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

describe("<DeleteBudgetDialog> — accessibility (reuses the Phase 7/8 confirm pattern)", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never auto-focuses Confirm on open", () => {
    render(<DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />);
    expect(document.activeElement).not.toHaveAccessibleName("Confirm");
  });

  it("keeps focus inside the dialog on open", () => {
    render(<DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Tab cycles only between Cancel and Confirm", async () => {
    const user = userEvent.setup();
    render(<DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
  });
});

describe("<DeleteBudgetDialog> — behavior", () => {
  it("shows the category and monthly limit in the preview, never auto-committing", () => {
    render(<DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />);
    expect(screen.getByText("Dining")).toBeInTheDocument();
    expect(screen.getByText("₹6,000.00")).toBeInTheDocument();
  });

  it("calls deleteBudgetAction with this budget's id on Confirm", async () => {
    const { deleteBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(deleteBudgetAction).toHaveBeenCalledWith("budget-1");
  });

  it("does not call deleteBudgetAction when Cancel is clicked", async () => {
    const { deleteBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteBudgetAction).not.toHaveBeenCalled();
  });

  it("recreates the budget via createBudgetAction on Undo -- category/amount/period are all held client-side, unlike a transfer leg", async () => {
    const { deleteBudgetAction, createBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(deleteBudgetAction).toHaveBeenCalledWith("budget-1");
    const undoButton = await screen.findByRole("button", { name: "Undo" });
    await user.click(undoButton);
    expect(createBudgetAction).toHaveBeenCalledWith({
      categoryId: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
      amountMinor: 600000,
      periodStart: "2026-08-01",
    });
  });

  it("shows Try again after a failed delete", async () => {
    const { deleteBudgetAction } = await import("./actions");
    vi.mocked(deleteBudgetAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "delete_failed", message: "Couldn't delete this budget. Try again." },
    });
    const user = userEvent.setup();
    render(<DeleteBudgetDialog budget={budget} categoryName="Dining" open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
