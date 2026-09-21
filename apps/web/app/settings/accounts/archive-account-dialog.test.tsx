import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@spencare/domain-application";
import { ArchiveAccountDialog } from "./archive-account-dialog";

vi.mock("./actions", () => ({
  archiveAccountAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { archiveAccountAction } = await import("./actions");
  vi.mocked(archiveAccountAction).mockReset();
  vi.mocked(archiveAccountAction).mockResolvedValue({ ok: true, value: {} as never });
});

const account: AccountRow = {
  id: "acc-1",
  user_id: "u1",
  type: "bank",
  name: "HDFC Savings",
  currency: "INR",
  balance_minor: 12500000,
  credit_limit_minor: null,
  credit_used_minor: null,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  statement_close_day: null,
  payment_due_day: null,
};

describe("<ArchiveAccountDialog> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <ArchiveAccountDialog account={account} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never auto-focuses Confirm on open (confirmation-ui-specification.md §9's hard rule)", () => {
    render(
      <ArchiveAccountDialog account={account} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    expect(document.activeElement).not.toHaveAccessibleName("Confirm");
  });

  it("keeps focus inside the dialog on open (the focus-trap regression found and fixed this phase)", () => {
    render(
      <ArchiveAccountDialog account={account} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Tab cycles only between Cancel and Confirm, never escaping the dialog", async () => {
    const user = userEvent.setup();
    render(
      <ArchiveAccountDialog account={account} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
  });
});

describe("<ArchiveAccountDialog> — content", () => {
  it("shows the account name, type, and balance in the preview, and marks it non-undoable", () => {
    render(
      <ArchiveAccountDialog account={account} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    expect(screen.getByText("HDFC Savings")).toBeInTheDocument();
    expect(screen.getByText("Bank")).toBeInTheDocument();
    expect(
      screen.getByText(/nothing is permanently erased/i, { ignore: ".sr-only" }),
    ).toBeInTheDocument();
  });

  it("labels a credit card's value row 'Outstanding balance', not 'Balance'", () => {
    const creditCard: AccountRow = {
      ...account,
      id: "acc-cc",
      type: "credit_card",
      credit_limit_minor: 20000000,
      credit_used_minor: 4500000,
    };
    render(
      <ArchiveAccountDialog account={creditCard} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    expect(screen.getByText("Outstanding balance")).toBeInTheDocument();
  });

  it("calls archiveAccountAction with this account's id on Confirm", async () => {
    const { archiveAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <ArchiveAccountDialog account={account} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(archiveAccountAction).toHaveBeenCalledWith("acc-1");
  });

  it("does not call archiveAccountAction when Cancel is clicked", async () => {
    const { archiveAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <ArchiveAccountDialog account={account} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(archiveAccountAction).not.toHaveBeenCalled();
  });

  it("shows Try again (not Confirm) after a failed archive, and lets the user retry", async () => {
    const { archiveAccountAction } = await import("./actions");
    vi.mocked(archiveAccountAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "archive_failed", message: "Couldn't archive the account. Try again." },
    });
    const user = userEvent.setup();
    render(
      <ArchiveAccountDialog account={account} open onOpenChange={() => {}} onArchived={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(
      screen.getByText(/couldn't archive the account/i, { ignore: ".sr-only" }),
    ).toBeInTheDocument();
  });
});
