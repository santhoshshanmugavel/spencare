import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataBackupManager } from "./data-backup-manager";
import { exportUserDataAction, deleteAccountAction } from "../actions";

vi.mock("../actions", () => ({
  exportUserDataAction: vi.fn(),
  deleteAccountAction: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// jsdom doesn't implement these -- stub them so the download flow doesn't throw.
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

describe("<DataBackupManager> — export", () => {
  it("shows the hub rows for export and delete", () => {
    render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={false} />);
    expect(screen.getByText("Export my data")).toBeInTheDocument();
    expect(screen.getByText("Delete my account")).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
  });

  it("Export calls exportUserDataAction and shows a downloaded confirmation, never a fabricated 'check your email' promise", async () => {
    const user = userEvent.setup();
    vi.mocked(exportUserDataAction).mockResolvedValue({ exportedAt: "t", profile: null, accounts: [], transactions: [], budgets: [], goals: [], bills: [], aiConversations: [] });

    render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(screen.getByText("Export downloaded")).toBeInTheDocument());
    expect(screen.queryByText(/email/i)).not.toBeInTheDocument();
  });

  it("Export failure shows an error toast, never crashes", async () => {
    const { toastError } = await import("@/lib/toast");
    const user = userEvent.setup();
    vi.mocked(exportUserDataAction).mockRejectedValue(new Error("boom"));

    render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

describe("<DataBackupManager> — delete flow, step 1 (consequences)", () => {
  it("Delete opens the consequences dialog, listing what will be lost, and does not delete immediately", async () => {
    const user = userEvent.setup();
    render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={false} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("dialog", { name: "Delete my account?" })).toBeInTheDocument();
    expect(screen.getByText("Transaction history and insights")).toBeInTheDocument();
    expect(screen.getByText("All accounts and balances")).toBeInTheDocument();
    expect(deleteAccountAction).not.toHaveBeenCalled();
  });

  it("Close dismisses the flow without deleting", async () => {
    const user = userEvent.setup();
    render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteAccountAction).not.toHaveBeenCalled();
  });

  it("'Verify & delete' advances to the verification step, not an immediate delete", async () => {
    const user = userEvent.setup();
    render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Verify & delete" }));

    expect(screen.getByRole("dialog", { name: "Verify it's you" })).toBeInTheDocument();
    expect(deleteAccountAction).not.toHaveBeenCalled();
  });
});

describe("<DataBackupManager> — delete flow, step 2 (verification)", () => {
  async function openVerifyStep(twoFactorEnabled = false) {
    const user = userEvent.setup();
    render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={twoFactorEnabled} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Verify & delete" }));
    return user;
  }

  it("the confirm button is disabled until an email is typed", async () => {
    await openVerifyStep();
    const dialog = screen.getByRole("dialog", { name: "Verify it's you" });
    expect(within(dialog).getByRole("button", { name: "Delete my account" })).toBeDisabled();
  });

  it("shows a 2FA code field only when the account has 2FA enabled", async () => {
    await openVerifyStep(true);
    expect(screen.getByLabelText("2FA code")).toBeInTheDocument();
  });

  it("no 2FA field is rendered for a non-2FA account", async () => {
    await openVerifyStep(false);
    expect(screen.queryByLabelText("2FA code")).not.toBeInTheDocument();
  });

  it("submits confirmEmail (and the 2FA code when applicable) to deleteAccountAction", async () => {
    const user = await openVerifyStep(true);
    vi.mocked(deleteAccountAction).mockResolvedValue({ ok: true, value: undefined });

    await user.type(screen.getByLabelText(/Type "user@example.com" to confirm/), "user@example.com");
    await user.type(screen.getByLabelText("2FA code"), "123456");
    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    expect(deleteAccountAction).toHaveBeenCalledWith({ confirmEmail: "user@example.com", twoFactorCode: "123456" });
  });

  it("on success, redirects to /login and never re-renders the form", async () => {
    const user = await openVerifyStep();
    vi.mocked(deleteAccountAction).mockResolvedValue({ ok: true, value: undefined });

    await user.type(screen.getByLabelText(/Type "user@example.com" to confirm/), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });

  it("on a structured error (e.g. email mismatch), shows it inline and never navigates away", async () => {
    const user = await openVerifyStep();
    vi.mocked(deleteAccountAction).mockResolvedValue({ ok: false, error: { code: "email_mismatch", message: "Type your account email exactly to confirm." } });

    await user.type(screen.getByLabelText(/Type "user@example.com" to confirm/), "wrong@example.com");
    await user.click(screen.getByRole("button", { name: "Delete my account" }));

    await waitFor(() => expect(screen.getByText("Type your account email exactly to confirm.")).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("<DataBackupManager> — accessibility", () => {
  it("has no axe violations in the hub state", async () => {
    const { container } = render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in the consequences dialog", async () => {
    const user = userEvent.setup();
    const { container } = render(<DataBackupManager accountEmail="user@example.com" twoFactorEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
