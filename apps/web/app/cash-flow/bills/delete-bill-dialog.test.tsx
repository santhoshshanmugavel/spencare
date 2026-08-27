import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillDefinitionRow } from "@spencare/domain-application";
import { DeleteBillDialog } from "./delete-bill-dialog";

vi.mock("./actions", () => ({
  deleteBillAction: vi.fn(async () => ({ ok: true, value: undefined })),
  restoreBillAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { deleteBillAction, restoreBillAction } = await import("./actions");
  vi.mocked(deleteBillAction).mockReset();
  vi.mocked(deleteBillAction).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(restoreBillAction).mockReset();
  vi.mocked(restoreBillAction).mockResolvedValue({ ok: true, value: {} as never });
});

const bill: BillDefinitionRow = {
  id: "bill-1",
  user_id: "user-a",
  merchant_pattern: "Netflix",
  category_id: null,
  expected_amount_minor: 49900,
  expected_amount_tolerance_pct: null,
  recurrence_interval: "monthly",
  detection_source: "manual",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

describe("<DeleteBillDialog> — accessibility (reuses the established confirm pattern)", () => {
  it("has no axe violations", async () => {
    const { container } = render(<DeleteBillDialog bill={bill} open onOpenChange={() => {}} onDeleted={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never auto-focuses Confirm on open", () => {
    render(<DeleteBillDialog bill={bill} open onOpenChange={() => {}} onDeleted={() => {}} />);
    expect(document.activeElement).not.toHaveAccessibleName("Confirm");
  });

  it("keeps focus inside the dialog on open", () => {
    render(<DeleteBillDialog bill={bill} open onOpenChange={() => {}} onDeleted={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("<DeleteBillDialog> — behavior", () => {
  it("shows the bill name in the preview, never auto-committing", () => {
    render(<DeleteBillDialog bill={bill} open onOpenChange={() => {}} onDeleted={() => {}} />);
    expect(screen.getAllByText("Netflix").length).toBeGreaterThan(0);
  });

  it("calls deleteBillAction with this bill's id on Confirm", async () => {
    const { deleteBillAction } = await import("./actions");
    const user = userEvent.setup();
    render(<DeleteBillDialog bill={bill} open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(deleteBillAction).toHaveBeenCalledWith("bill-1");
  });

  it("does not call deleteBillAction when Cancel is clicked", async () => {
    const { deleteBillAction } = await import("./actions");
    const user = userEvent.setup();
    render(<DeleteBillDialog bill={bill} open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteBillAction).not.toHaveBeenCalled();
  });

  it("REGRESSION (real defect found live): Undo restores the SAME row via restoreBillAction, not a recreate that would duplicate the bill's own surviving prediction", async () => {
    const { deleteBillAction, restoreBillAction } = await import("./actions");
    const user = userEvent.setup();
    render(<DeleteBillDialog bill={bill} open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(deleteBillAction).toHaveBeenCalledWith("bill-1");
    const undoButton = await screen.findByRole("button", { name: "Undo" });
    await user.click(undoButton);
    expect(restoreBillAction).toHaveBeenCalledWith("bill-1");
  });

  it("shows Try again after a failed delete", async () => {
    const { deleteBillAction } = await import("./actions");
    vi.mocked(deleteBillAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "delete_failed", message: "Couldn't delete this bill. Try again." },
    });
    const user = userEvent.setup();
    render(<DeleteBillDialog bill={bill} open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
