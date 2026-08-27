import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { DonutChart, type DonutChartSlice } from "./donut-chart";

const slices: DonutChartSlice[] = [
  { key: "dining", label: "Dining", amountMinor: 400000, percent: 66.67 },
  { key: "transport", label: "Transport", amountMinor: 200000, percent: 33.33 },
];

describe("<DonutChart> — accessibility", () => {
  it("has no axe violations (populated)", async () => {
    const { container } = render(<DonutChart slices={slices} totalMinor={600000} currency="INR" title="Spending" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations (empty)", async () => {
    const { container } = render(<DonutChart slices={[]} totalMinor={0} currency="INR" title="Spending" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the ring itself is decorative (aria-hidden) -- every real value comes from the legend/center text", () => {
    const { container } = render(<DonutChart slices={slices} totalMinor={600000} currency="INR" title="Spending" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("<DonutChart> — text-equivalent legend (do not rely on color alone)", () => {
  it("renders every category as real, readable text: name, percent, and amount", () => {
    render(<DonutChart slices={slices} totalMinor={600000} currency="INR" title="Spending" />);
    expect(screen.getByText("Dining")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("₹4,000.00")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getByText("₹2,000.00")).toBeInTheDocument();
  });

  it("renders the center total as real text, not baked into an inaccessible canvas/image", () => {
    render(<DonutChart slices={slices} totalMinor={600000} currency="INR" title="Spending" />);
    expect(screen.getByText("₹6,000.00")).toBeInTheDocument();
  });
});

describe("<DonutChart> — empty state (avoid misleading percentages when total is zero)", () => {
  it("shows an honest empty state, never a fabricated slice or a NaN%", () => {
    render(<DonutChart slices={[]} totalMinor={0} currency="INR" title="Spending" />);
    expect(screen.getByText(/no spending yet/i)).toBeInTheDocument();
    expect(screen.queryByText("NaN%")).not.toBeInTheDocument();
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
  });
});

describe("<DonutChart> — Privacy Mode", () => {
  it("masks the center total and every legend amount, leaking no raw value", () => {
    render(<DonutChart slices={slices} totalMinor={600000} currency="INR" title="Spending" masked />);
    expect(screen.queryByText("₹6,000.00")).not.toBeInTheDocument();
    expect(screen.queryByText("₹4,000.00")).not.toBeInTheDocument();
    expect(screen.queryByText("₹2,000.00")).not.toBeInTheDocument();
    const masks = screen.getAllByText("₹***");
    expect(masks.length).toBeGreaterThanOrEqual(3); // center + 2 legend rows
  });

  it("masks the legend percentage too, so no partial figure leaks alongside the hidden amount", () => {
    render(<DonutChart slices={slices} totalMinor={600000} currency="INR" title="Spending" masked />);
    expect(screen.queryByText("67%")).not.toBeInTheDocument();
    expect(screen.getAllByText("--%").length).toBe(2);
  });
});
