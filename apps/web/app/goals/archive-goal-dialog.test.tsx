import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalRow } from "@spencare/domain-application";
import { ArchiveGoalDialog } from "./archive-goal-dialog";

vi.mock("./actions", () => ({
  archiveGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
  restoreGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { archiveGoalAction, restoreGoalAction } = await import("./actions");
  vi.mocked(archiveGoalAction).mockReset();
  vi.mocked(archiveGoalAction).mockResolvedValue({ ok: true, value: {} as never });
  vi.mocked(restoreGoalAction).mockReset();
  vi.mocked(restoreGoalAction).mockResolvedValue({ ok: true, value: {} as never });
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
  term: "short",
  image_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  archived_at: null,
};

describe("<ArchiveGoalDialog> — accessibility (reuses the Phase 7/8/9 confirm pattern)", () => {
  it("has no axe violations", async () => {
    const { container } = render(<ArchiveGoalDialog goal={goal} open onOpenChange={() => {}} onArchived={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never auto-focuses Confirm on open", () => {
    render(<ArchiveGoalDialog goal={goal} open onOpenChange={() => {}} onArchived={() => {}} />);
    expect(document.activeElement).not.toHaveAccessibleName("Confirm");
  });

  it("keeps focus inside the dialog on open", () => {
    render(<ArchiveGoalDialog goal={goal} open onOpenChange={() => {}} onArchived={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Tab cycles only between Cancel and Confirm", async () => {
    const user = userEvent.setup();
    render(<ArchiveGoalDialog goal={goal} open onOpenChange={() => {}} onArchived={() => {}} />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
  });
});

describe("<ArchiveGoalDialog> — behavior", () => {
  it("calls archiveGoalAction with this goal's id on Confirm", async () => {
    const { archiveGoalAction } = await import("./actions");
    const user = userEvent.setup();
    render(<ArchiveGoalDialog goal={goal} open onOpenChange={() => {}} onArchived={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(archiveGoalAction).toHaveBeenCalledWith(goal.id);
  });

  it("does not call archiveGoalAction when Cancel is clicked", async () => {
    const { archiveGoalAction } = await import("./actions");
    const user = userEvent.setup();
    render(<ArchiveGoalDialog goal={goal} open onOpenChange={() => {}} onArchived={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(archiveGoalAction).not.toHaveBeenCalled();
  });

  it("calls restoreGoalAction on Undo after a successful archive (a genuine, full-fidelity inverse)", async () => {
    const { archiveGoalAction, restoreGoalAction } = await import("./actions");
    const user = userEvent.setup();
    render(<ArchiveGoalDialog goal={goal} open onOpenChange={() => {}} onArchived={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(archiveGoalAction).toHaveBeenCalledWith(goal.id);
    const undoButton = await screen.findByRole("button", { name: "Undo" });
    await user.click(undoButton);
    expect(restoreGoalAction).toHaveBeenCalledWith(goal.id);
  });

  it("shows Try again after a failed archive", async () => {
    const { archiveGoalAction } = await import("./actions");
    vi.mocked(archiveGoalAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "archive_failed", message: "Couldn't archive the goal. Try again." },
    });
    const user = userEvent.setup();
    render(<ArchiveGoalDialog goal={goal} open onOpenChange={() => {}} onArchived={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
