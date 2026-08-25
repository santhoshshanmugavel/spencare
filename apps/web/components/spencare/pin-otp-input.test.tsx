import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { PinOtpInput } from "./pin-otp-input";

describe("<PinOtpInput>", () => {
  it("renders the requested number of digit boxes", () => {
    render(<PinOtpInput length={4} value="" onChange={() => {}} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
  });

  it("renders 6 boxes for OTP length", () => {
    render(<PinOtpInput length={6} value="" onChange={() => {}} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
  });

  it("each box has a per-digit accessible label (accessibility-requirements.md §1)", () => {
    render(<PinOtpInput length={4} value="" onChange={() => {}} masked />);
    expect(screen.getByLabelText("PIN digit 1 of 4")).toBeInTheDocument();
    expect(screen.getByLabelText("PIN digit 4 of 4")).toBeInTheDocument();
  });

  it("uses inputMode=numeric on every box", () => {
    render(<PinOtpInput length={4} value="" onChange={() => {}} />);
    for (const box of screen.getAllByRole("textbox")) {
      expect(box).toHaveAttribute("inputmode", "numeric");
    }
  });

  it("PIN mode masks input via type=password", () => {
    render(<PinOtpInput length={4} value="" onChange={() => {}} masked />);
    const first = screen.getByLabelText("PIN digit 1 of 4");
    expect(first).toHaveAttribute("type", "password");
  });

  it("OTP mode shows visible digits via type=text", () => {
    render(<PinOtpInput length={6} value="" onChange={() => {}} />);
    const first = screen.getByLabelText("Verification code digit 1 of 6");
    expect(first).toHaveAttribute("type", "text");
  });

  it("auto-advances focus to the next box on digit entry", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PinOtpInput length={4} value="" onChange={onChange} />);
    const boxes = screen.getAllByRole("textbox");
    await user.type(boxes[0]!, "1");
    expect(onChange).toHaveBeenCalledWith("1");
    expect(boxes[1]).toHaveFocus();
  });

  it("Backspace on an empty box retreats focus to the previous box", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PinOtpInput length={4} value="12" onChange={onChange} />);
    const boxes = screen.getAllByRole("textbox");
    boxes[2]!.focus();
    await user.keyboard("{Backspace}");
    expect(boxes[1]).toHaveFocus();
  });

  it("Arrow keys move focus between boxes", async () => {
    const user = userEvent.setup();
    render(<PinOtpInput length={4} value="1234" onChange={() => {}} />);
    const boxes = screen.getAllByRole("textbox");
    boxes[1]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(boxes[2]).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(boxes[1]).toHaveFocus();
  });

  it("pasting a full code fills all boxes and focuses the last filled one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PinOtpInput length={6} value="" onChange={onChange} />);
    const boxes = screen.getAllByRole("textbox");
    boxes[0]!.focus();
    await user.paste("482913");
    expect(onChange).toHaveBeenCalledWith("482913");
  });

  it("renders an error state with aria-invalid", () => {
    render(<PinOtpInput length={4} value="" onChange={() => {}} error />);
    for (const box of screen.getAllByRole("textbox")) {
      expect(box).toHaveAttribute("aria-invalid", "true");
    }
  });

  it("disabled boxes cannot be focused/typed into", () => {
    render(<PinOtpInput length={4} value="" onChange={() => {}} disabled />);
    for (const box of screen.getAllByRole("textbox")) {
      expect(box).toBeDisabled();
    }
  });

  it("has no axe violations (PIN mode)", async () => {
    const { container } = render(<PinOtpInput length={4} value="" onChange={() => {}} masked />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations (OTP mode, error state)", async () => {
    const { container } = render(<PinOtpInput length={6} value="" onChange={() => {}} error />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
