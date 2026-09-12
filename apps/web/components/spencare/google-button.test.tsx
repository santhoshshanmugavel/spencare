import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { GoogleButton } from "./google-button";

describe("<GoogleButton>", () => {
  it("has no axe violations", async () => {
    const { container } = render(<GoogleButton action={async () => {}} label="Continue with Google" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders a submit button with the provided label", () => {
    render(<GoogleButton action={async () => {}} label="Continue with Google" />);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("button has touch size attribute", () => {
    render(<GoogleButton action={async () => {}} label="Continue with Google" />);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toHaveAttribute("data-size", "touch");
  });

  it("calls the action when submitted", async () => {
    const action = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<GoogleButton action={action} label="Continue with Google" />);
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(action).toHaveBeenCalledOnce();
  });

  it("is not disabled by default", () => {
    render(<GoogleButton action={async () => {}} label="Continue with Google" />);
    expect(screen.getByRole("button", { name: "Continue with Google" })).not.toBeDisabled();
  });

  it("renders a Google SVG icon inside the button", () => {
    render(<GoogleButton action={async () => {}} label="Continue with Google" />);
    const svg = document.querySelector("svg[aria-hidden='true']");
    expect(svg).toBeInTheDocument();
  });
});
