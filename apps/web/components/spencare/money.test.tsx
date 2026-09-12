import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Money as DomainMoney } from "@spencare/domain-core";
import { Money } from "./money";

describe("<Money> — formatting", () => {
  it("renders Indian-grouped digits with the currency symbol", () => {
    render(<Money value={DomainMoney.fromMinorUnits(5791000n, "INR")} />);
    expect(screen.getByText("₹57,910.00")).toBeInTheDocument();
  });

  it("uses tabular-nums for numeric alignment", () => {
    render(<Money value={DomainMoney.fromMinorUnits(50000n, "INR")} />);
    expect(screen.getByText("₹500.00")).toHaveClass("tabular-nums");
  });
});

describe("<Money> — Privacy Mode masking", () => {
  it("renders a fixed-width mask regardless of amount length, per design-tokens.md's confirmed-correct pattern", () => {
    const { rerender } = render(<Money value={DomainMoney.fromMinorUnits(500n, "INR")} masked />);
    expect(screen.getByText("₹***")).toBeInTheDocument();

    rerender(<Money value={DomainMoney.fromMinorUnits(500000000n, "INR")} masked />);
    expect(screen.getByText("₹***")).toBeInTheDocument(); // same mask length, no digit-count leak
  });

  it("never renders the real digits when masked", () => {
    render(<Money value={DomainMoney.fromMinorUnits(5791000n, "INR")} masked />);
    expect(screen.queryByText(/57,910/)).not.toBeInTheDocument();
  });
});

describe("<Money> — tone / sign treatment (design-decisions.md DD-09)", () => {
  it('tone="positive" shows an explicit "+" and the success color class', () => {
    render(<Money value={DomainMoney.fromMinorUnits(2000000n, "INR")} tone="positive" />);
    const el = screen.getByText("+₹20,000.00");
    expect(el).toHaveClass("text-success");
  });

  it('tone="negative" shows the destructive color with NO forced minus sign (row context implies direction)', () => {
    render(<Money value={DomainMoney.fromMinorUnits(49900n, "INR")} tone="negative" />);
    const el = screen.getByText("₹499.00");
    expect(el).toHaveClass("text-destructive");
  });

  it('tone="neutral" (default) shows plain digits with no color class and no sign', () => {
    render(<Money value={DomainMoney.fromMinorUnits(620000n, "INR")} />);
    const el = screen.getByText("₹6,200.00");
    expect(el).not.toHaveClass("text-success");
    expect(el).not.toHaveClass("text-destructive");
  });

  it('tone="auto" on a genuinely negative value shows an explicit "-" sign (api-architecture.md §8.4 -- never silently hidden)', () => {
    const negativeSafeToSpend = DomainMoney.fromMinorUnits(100n, "INR").subtract(
      DomainMoney.fromMinorUnits(500n, "INR"),
    );
    render(<Money value={negativeSafeToSpend} tone="auto" />);
    const el = screen.getByText("-₹4.00");
    expect(el).toHaveClass("text-destructive");
  });

  it('tone="auto" on a positive value shows "+" and success color', () => {
    render(<Money value={DomainMoney.fromMinorUnits(100n, "INR")} tone="auto" />);
    expect(screen.getByText("+₹1.00")).toHaveClass("text-success");
  });

  it("zero amount never gets a + sign even with tone=positive", () => {
    render(<Money value={DomainMoney.zero("INR")} tone="positive" />);
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    expect(screen.queryByText("+₹0.00")).not.toBeInTheDocument();
  });
});

describe("<Money> — hero sizing (information-architecture.md §4)", () => {
  it('size="hero" applies the largest financial-figure treatment', () => {
    render(<Money value={DomainMoney.fromMinorUnits(2212300n, "INR")} size="hero" />);
    const el = screen.getByText("₹22,123.00");
    expect(el.className).toMatch(/text-4xl/);
    expect(el.className).toMatch(/font-bold/);
  });
});

describe("<Money> — accessibility", () => {
  it("has an accessible label describing the amount even when visually just digits", () => {
    render(<Money value={DomainMoney.fromMinorUnits(50000n, "INR")} />);
    expect(screen.getByLabelText(/₹500 point 00/)).toBeInTheDocument();
  });

  it("masked amounts announce as hidden, not silently omitted (accessibility-requirements.md §3)", () => {
    render(<Money value={DomainMoney.fromMinorUnits(50000n, "INR")} masked />);
    expect(screen.getByLabelText(/Amount hidden/)).toBeInTheDocument();
  });
});
