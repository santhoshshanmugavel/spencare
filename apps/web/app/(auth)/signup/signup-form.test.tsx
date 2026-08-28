import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { SignUpForm } from "./signup-form";

vi.mock("../actions", () => ({
  signUpAction: vi.fn(async () => ({ ok: true })),
}));

describe("<SignUpForm>", () => {
  it("has no axe violations", async () => {
    const { container } = render(<SignUpForm redirectTarget={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("rejects a weak password client-side before calling the server action", async () => {
    const { signUpAction } = await import("../actions");
    const user = userEvent.setup();
    render(<SignUpForm redirectTarget={null} />);
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "weak");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 8 characters/i);
    expect(signUpAction).not.toHaveBeenCalled();
  });

  it("the password field is associated with its policy hint via aria-describedby when valid", () => {
    render(<SignUpForm redirectTarget={null} />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", "password-hint");
  });

  it("calls signUpAction with a compliant email/password", async () => {
    const { signUpAction } = await import("../actions");
    const user = userEvent.setup();
    render(<SignUpForm redirectTarget="/settings/profile" />);
    await user.type(screen.getByLabelText("Email"), "new-user@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUpAction).toHaveBeenCalledWith(
      { email: "new-user@example.com", password: "StrongPass1" },
      "/settings/profile",
    );
  });
});
