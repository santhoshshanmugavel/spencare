import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

vi.mock("../actions", () => ({
  signInAction: vi.fn(async () => ({ ok: true })),
}));

describe("<LoginForm>", () => {
  it("has no axe violations", async () => {
    const { container } = render(<LoginForm redirectTarget={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("email and password fields have accessible labels", () => {
    render(<LoginForm redirectTarget={null} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows a client-side validation error with aria-invalid and aria-describedby, never submitting to the server", async () => {
    const { signInAction } = await import("../actions");
    const user = userEvent.setup();
    render(<LoginForm redirectTarget={null} />);
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const emailInput = screen.getByLabelText("Email");
    expect(emailInput).toHaveAttribute("aria-invalid", "true");
    expect(emailInput.getAttribute("aria-describedby")).toBe("email-error");
    expect(signInAction).not.toHaveBeenCalled();
  });

  it("the password visibility toggle switches the input type and exposes aria-pressed", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectTarget={null} />);
    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Show" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
  });

  it("surfaces the server-returned error without leaking a raw provider message (mapping happens server-side)", async () => {
    const { signInAction } = await import("../actions");
    vi.mocked(signInAction).mockResolvedValueOnce({ ok: false, error: "Incorrect email or password." });
    const user = userEvent.setup();
    render(<LoginForm redirectTarget={null} />);
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "whatever1A");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });

  it("Sign in / Continue with Google buttons both meet the touch-target size", () => {
    render(<LoginForm redirectTarget={null} />);
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute("data-size", "touch");
  });
});
