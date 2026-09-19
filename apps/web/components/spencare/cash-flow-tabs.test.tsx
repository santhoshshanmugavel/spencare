import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { CashFlowTabs } from "./cash-flow-tabs";

describe("<CashFlowTabs>", () => {
  it("has no axe violations", async () => {
    const { container } = render(<CashFlowTabs active="upcoming" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders all tabs as real links, Bills is removed", () => {
    render(<CashFlowTabs active="transactions" />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/cash-flow");
    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute("href", "/cash-flow/transactions");
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute("href", "/cash-flow/budgets");
    expect(screen.getByRole("link", { name: "Upcoming" })).toHaveAttribute("href", "/cash-flow/upcoming");
    expect(screen.queryByRole("link", { name: "Bills" })).toBeNull();
  });

  it("marks the active tab distinctly from the others", () => {
    render(<CashFlowTabs active="upcoming" />);
    const upcoming = screen.getByRole("link", { name: "Upcoming" });
    const budgets = screen.getByRole("link", { name: "Budgets" });
    expect(upcoming.className).not.toBe(budgets.className);
  });
});
