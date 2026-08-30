import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import type { BudgetWithUsage, CategoryRow } from "@spencare/domain-application";
import { BudgetDashboard } from "./budget-dashboard";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

vi.mock("./actions", () => ({
  createBudgetAction: vi.fn(async () => ({ ok: true, value: {} })),
  updateBudgetAction: vi.fn(async () => ({ ok: true, value: {} })),
  deleteBudgetAction: vi.fn(async () => ({ ok: true, value: undefined })),
}));

const categories: CategoryRow[] = [
  { id: "289f5e56-21a8-4ee0-865f-c02c11f4d874", user_id: null, name: "Dining", icon: "utensils", is_system: true },
  { id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491", user_id: null, name: "Transport", icon: "car", is_system: true },
];

function usage(overrides: Partial<BudgetWithUsage> = {}): BudgetWithUsage {
  return {
    id: "budget-1",
    categoryId: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    limitMinor: 600000,
    spentMinor: 470000,
    remainingMinor: 130000,
    percentUsed: 78.33,
    status: "near_limit",
    isRecurring: false,
    ...overrides,
  };
}

describe("<BudgetDashboard> — empty state", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <BudgetDashboard periodStart="2026-08-01" usages={[]} categories={categories} masked={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an honest empty state, not fabricated budgets", () => {
    render(<BudgetDashboard periodStart="2026-08-01" usages={[]} categories={categories} masked={false} />);
    expect(screen.getByText(/no budgets set for august 2026/i)).toBeInTheDocument();
  });
});

describe("<BudgetDashboard> — populated (near-limit)", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <BudgetDashboard periodStart="2026-08-01" usages={[usage()]} categories={categories} masked={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("labels the rollup 'Budget remaining', never 'Available to spend' or 'Safe to Spend' (locked Safe-to-Spend boundary)", () => {
    render(<BudgetDashboard periodStart="2026-08-01" usages={[usage()]} categories={categories} masked={false} />);
    expect(screen.getByText("Budget remaining")).toBeInTheDocument();
    expect(screen.queryByText(/available to spend/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/safe to spend/i)).not.toBeInTheDocument();
  });

  it("shows a neutral 'remaining' label and amount for an under-limit category, not a signed '+' figure", () => {
    render(<BudgetDashboard periodStart="2026-08-01" usages={[usage()]} categories={categories} masked={false} />);
    const row = screen.getByRole("button", { name: "Dining, edit budget" });
    expect(within(row).getByText("₹1,300.00")).toBeInTheDocument();
    expect(within(row).getByText("remaining")).toBeInTheDocument();
    expect(screen.queryByText("+₹1,300.00")).not.toBeInTheDocument();
  });

  it("masks every budget figure under Privacy Mode", () => {
    render(<BudgetDashboard periodStart="2026-08-01" usages={[usage()]} categories={categories} masked />);
    expect(screen.getAllByText("Amount hidden").length).toBeGreaterThan(0);
    expect(screen.queryByText("₹1,300.00")).not.toBeInTheDocument();
  });
});

describe("<BudgetDashboard> — exceeded state (SP-166's own 'over replaces remaining')", () => {
  it("shows an 'over' label with the overage magnitude, not a negative remaining figure", () => {
    const exceeded = usage({ spentMinor: 670000, remainingMinor: -70000, percentUsed: 111.67, status: "exceeded" });
    render(<BudgetDashboard periodStart="2026-08-01" usages={[exceeded]} categories={categories} masked={false} />);
    const row = screen.getByRole("button", { name: "Dining, edit budget" });
    expect(within(row).getByText("₹700.00")).toBeInTheDocument();
    expect(within(row).getByText("over")).toBeInTheDocument();
    expect(screen.getByText("Over budget")).toBeInTheDocument();
    expect(screen.queryByText("remaining")).not.toBeInTheDocument();
    expect(screen.queryByText("-₹700.00")).not.toBeInTheDocument();
  });
});

describe("<BudgetDashboard> — row interactions", () => {
  it("opens Edit on row click", async () => {
    const user = userEvent.setup();
    render(<BudgetDashboard periodStart="2026-08-01" usages={[usage()]} categories={categories} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Dining, edit budget" }));
    expect(screen.getByRole("heading", { name: "Edit Dining budget" })).toBeInTheDocument();
  });

  it("Delete opens only the delete confirmation, not Edit too (regression: hoverActions used to bubble into the row's own onClick)", async () => {
    const user = userEvent.setup();
    render(<BudgetDashboard periodStart="2026-08-01" usages={[usage()]} categories={categories} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit Dining budget" })).not.toBeInTheDocument();
  });

  it("opens Add budget from the header button", async () => {
    const user = userEvent.setup();
    render(<BudgetDashboard periodStart="2026-08-01" usages={[usage()]} categories={categories} masked={false} />);
    await user.click(screen.getByRole("button", { name: "+ Add budget" }));
    expect(screen.getByRole("heading", { name: "Add budget" })).toBeInTheDocument();
  });

  it("disables Add budget when every category already has a budget this period", () => {
    const bothBudgeted = [usage(), usage({ id: "budget-2", categoryId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491" })];
    render(<BudgetDashboard periodStart="2026-08-01" usages={bothBudgeted} categories={categories} masked={false} />);
    expect(screen.getByRole("button", { name: "+ Add budget" })).toBeDisabled();
  });

  it("navigates to the adjacent month via Previous/Next", async () => {
    const user = userEvent.setup();
    render(<BudgetDashboard periodStart="2026-08-01" usages={[usage()]} categories={categories} masked={false} />);
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(push).toHaveBeenCalledWith("/cash-flow/budgets?month=2026-09-01");
    await user.click(screen.getByRole("button", { name: /previous/i }));
    expect(push).toHaveBeenCalledWith("/cash-flow/budgets?month=2026-07-01");
  });
});
