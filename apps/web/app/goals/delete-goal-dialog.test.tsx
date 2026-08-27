import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalRow } from "@spencare/domain-application";
import { DeleteGoalDialog } from "./delete-goal-dialog";

vi.mock("./actions", () => ({
  deleteGoalAction: vi.fn(async () => ({ ok: true, value: undefined })),
}));
vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

beforeEach(async () => {
  const { deleteGoalAction } = await import("./actions");
  vi.mocked(deleteGoalAction).mockReset();
  vi.mocked(deleteGoalAction).mockResolvedValue({ ok: true, value: undefined });
  const { toastConfirmed, toastError } = await import("@/lib/toast");
  vi.mocked(toastConfirmed).mockReset();
  vi.mocked(toastError).mockReset();
});

const goal: GoalRow = {
  id: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
  user_id: "u1",
  name: "Vietnam Trip",
  target_amount_minor: 5500000,
  target_date: null,
  funding_account_id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
  saved_amount_minor: 300000,
  status: "active",
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

describe("<DeleteGoalDialog> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<DeleteGoalDialog goal={goal} open onOpenChange={() => {}} onDeleted={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never auto-focuses Confirm on open", () => {
    render(<DeleteGoalDialog goal={goal} open onOpenChange={() => {}} onDeleted={() => {}} />);
    expect(document.activeElement).not.toHaveAccessibleName("Confirm");
  });

  it("keeps focus inside the dialog on open", () => {
    render(<DeleteGoalDialog goal={goal} open onOpenChange={() => {}} onDeleted={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Tab cycles only between Cancel and Confirm", async () => {
    const user = userEvent.setup();
    render(<DeleteGoalDialog goal={goal} open onOpenChange={() => {}} onDeleted={() => {}} />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
  });
});

describe("<DeleteGoalDialog> — behavior", () => {
  it("warns this can't be undone and never offers an Undo button (Phase 11 §10: no fake Undo)", async () => {
    const { toastConfirmed } = await import("@/lib/toast");
    const user = userEvent.setup();
    render(<DeleteGoalDialog goal={goal} open onOpenChange={() => {}} onDeleted={() => {}} />);
    expect(screen.getByText(/can't be undone/i, { ignore: ".sr-only" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(toastConfirmed).toHaveBeenCalledWith(expect.stringMatching(/deleted/i));
    // Only ever called with a plain message, no undoable/onUndo options -- unlike Archive's toast.
    expect(toastConfirmed).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ undoable: true }));
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("calls deleteGoalAction with this goal's id on Confirm", async () => {
    const { deleteGoalAction } = await import("./actions");
    const user = userEvent.setup();
    render(<DeleteGoalDialog goal={goal} open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(deleteGoalAction).toHaveBeenCalledWith(goal.id);
  });

  it("does not call deleteGoalAction when Cancel is clicked", async () => {
    const { deleteGoalAction } = await import("./actions");
    const user = userEvent.setup();
    render(<DeleteGoalDialog goal={goal} open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteGoalAction).not.toHaveBeenCalled();
  });

  it("shows Try again after a failed delete", async () => {
    const { deleteGoalAction } = await import("./actions");
    vi.mocked(deleteGoalAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "delete_failed", message: "Couldn't delete this goal. Try again." },
    });
    const user = userEvent.setup();
    render(<DeleteGoalDialog goal={goal} open onOpenChange={() => {}} onDeleted={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
