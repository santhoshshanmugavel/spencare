import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { VerifyTwoFactorForm } from "./verify-2fa-form";

vi.mock("./actions", () => ({
  verifyTwoFactorAction: vi.fn(async () => ({ ok: true })),
}));

describe("<VerifyTwoFactorForm>", () => {
  it("has no axe violations in TOTP mode", async () => {
    const { container } = render(<VerifyTwoFactorForm redirectTarget={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in backup-code mode", async () => {
    const user = userEvent.setup();
    const { container } = render(<VerifyTwoFactorForm redirectTarget={null} />);
    await user.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("defaults to 6 per-digit PIN/OTP boxes (reuses the Foundation PinOtpInput, not a plain text field)", () => {
    render(<VerifyTwoFactorForm redirectTarget={null} />);
    expect(screen.getAllByLabelText(/Verification code digit \d of 6/)).toHaveLength(6);
  });

  it("typing a digit auto-advances focus to the next box", async () => {
    const user = userEvent.setup();
    render(<VerifyTwoFactorForm redirectTarget={null} />);
    const boxes = screen.getAllByLabelText(/Verification code digit \d of 6/);
    await user.type(boxes[0]!, "1");
    expect(boxes[1]).toHaveFocus();
  });

  it("toggling to backup-code mode swaps in a single text field with the XXXX-XXXX placeholder", async () => {
    const user = userEvent.setup();
    render(<VerifyTwoFactorForm redirectTarget={null} />);
    await user.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    expect(screen.getByLabelText("Backup code")).toHaveAttribute("placeholder", "XXXX-XXXX");
    expect(screen.getByRole("button", { name: "Use your authenticator app instead" })).toBeInTheDocument();
  });

  it("calls verifyTwoFactorAction with the assembled 6-digit code and preserves the redirect target", async () => {
    const { verifyTwoFactorAction } = await import("./actions");
    const user = userEvent.setup();
    render(<VerifyTwoFactorForm redirectTarget="/settings/security" />);
    const boxes = screen.getAllByLabelText(/Verification code digit \d of 6/);
    await user.type(boxes[0]!, "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(verifyTwoFactorAction).toHaveBeenCalledWith("123456", "/settings/security");
  });

  it("surfaces an invalid-code server error via role=alert", async () => {
    const { verifyTwoFactorAction } = await import("./actions");
    vi.mocked(verifyTwoFactorAction).mockResolvedValueOnce({
      ok: false,
      error: "That code isn't valid. Try again or use a backup code.",
    });
    const user = userEvent.setup();
    render(<VerifyTwoFactorForm redirectTarget={null} />);
    const boxes = screen.getAllByLabelText(/Verification code digit \d of 6/);
    await user.type(boxes[0]!, "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't valid");
  });
});
