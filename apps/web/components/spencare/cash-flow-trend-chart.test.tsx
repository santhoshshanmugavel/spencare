import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { CashFlowTrendChart } from "./cash-flow-trend-chart";

// See home-content.test.tsx for why: jsdom has no layout engine and no
// HTMLCanvasElement.getContext(), so a real ECharts instance can't mount
// here. These tests verify the component's OWN logic (empty/masked
// states, the always-rendered accessible text summary), not ECharts'
// internal SVG/canvas rendering.
vi.mock("echarts", () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}));

const twoMonths = [
  { periodStart: "2026-07-01", incomeMinor: 500000, expenseMinor: 300000 },
  { periodStart: "2026-08-01", incomeMinor: 520000, expenseMinor: 410000 },
];

describe("<CashFlowTrendChart> — Privacy Mode (no exact amount may leak)", () => {
  it("renders no chart and no figures at all when masked -- a plain notice instead", () => {
    render(<CashFlowTrendChart points={twoMonths} currency="INR" masked />);
    expect(screen.getByText(/hidden while privacy mode is on/i)).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });
});

describe("<CashFlowTrendChart> — empty state (never a zero-value chart implying data that doesn't exist)", () => {
  it("shows 'Not enough data yet.' with fewer than 2 points", () => {
    render(<CashFlowTrendChart points={[twoMonths[0]!]} currency="INR" masked={false} />);
    expect(screen.getByText("Not enough data yet.")).toBeInTheDocument();
  });

  it("shows 'Not enough data yet.' with zero points", () => {
    render(<CashFlowTrendChart points={[]} currency="INR" masked={false} />);
    expect(screen.getByText("Not enough data yet.")).toBeInTheDocument();
  });
});

describe("<CashFlowTrendChart> — accessible text equivalent (matches DonutChart's own legend convention)", () => {
  it("always renders a real, screen-reader-visible summary with the exact figures, decorative chart marked aria-hidden", () => {
    const { container } = render(<CashFlowTrendChart points={twoMonths} currency="INR" masked={false} />);
    expect(screen.getByText(/jul: ₹5,000 in, ₹3,000 out/i)).toBeInTheDocument();
    expect(screen.getByText(/aug: ₹5,200 in, ₹4,100 out/i)).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("<CashFlowTrendChart> — accessibility", () => {
  it("has no axe violations, populated state", async () => {
    const { container } = render(<CashFlowTrendChart points={twoMonths} currency="INR" masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations, masked state", async () => {
    const { container } = render(<CashFlowTrendChart points={twoMonths} currency="INR" masked />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations, empty state", async () => {
    const { container } = render(<CashFlowTrendChart points={[]} currency="INR" masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
