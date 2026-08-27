import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { CashFlowTabs } from "./cash-flow-tabs";

describe("<CashFlowTabs>", () => {
  it("has no axe violations", async () => {
    const { container } = render(<CashFlowTabs active="bills" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders all three tabs, including the new Bills tab, each as a real link", () => {
    render(<CashFlowTabs active="transactions" />);
    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute("href", "/cash-flow/transactions");
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute("href", "/cash-flow/budgets");
    expect(screen.getByRole("link", { name: "Bills" })).toHaveAttribute("href", "/cash-flow/bills");
  });

  it("marks the active tab distinctly from the others", () => {
    render(<CashFlowTabs active="bills" />);
    const bills = screen.getByRole("link", { name: "Bills" });
    const budgets = screen.getByRole("link", { name: "Budgets" });
    expect(bills.className).not.toBe(budgets.className);
  });
});
