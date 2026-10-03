import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { summarizePlan } from "@spencare/domain-application";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { Money } from "@spencare/domain-core";
import { PlansGrid, type SerializedPlanWithSummary } from "./plans-grid";
import { serializePlanCalculations } from "@/lib/plan-calculations-serialization";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createPlanAction: vi.fn(async () => ({ ok: true, value: {} })),
  updatePlanBudgetAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

function planRow(overrides: Partial<FinancialPlanRow> = {}): FinancialPlanRow {
  return {
    id: "8f14e45f-ceea-467e-951c-d5f9f8e6d123",
    user_id: "u1",
    name: "Thailand Trip",
    description: "December vacation",
    status: "active",
    start_date: null,
    end_date: null,
    base_currency: "INR",
    original_budget_minor: null,
    current_budget_minor: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    archived_at: null,
    ...overrides,
  };
}

function withSummary(
  row: FinancialPlanRow,
  opts: { budgetMinor?: number; spentMinor?: number } = {},
): SerializedPlanWithSummary {
  const calculations = summarizePlan({
    plan: {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      baseCurrency: row.base_currency,
      originalBudget: opts.budgetMinor != null ? Money.fromMinorUnits(BigInt(opts.budgetMinor), row.base_currency) : null,
      currentBudget: opts.budgetMinor != null ? Money.fromMinorUnits(BigInt(opts.budgetMinor), row.base_currency) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      archivedAt: row.archived_at,
    },
    items: [],
    transactions:
      opts.spentMinor != null
        ? [
            {
              id: "t1",
              type: "expense" as const,
              amount: Money.fromMinorUnits(BigInt(opts.spentMinor), row.base_currency),
              occurredAt: "2026-01-05",
              deletedAt: null,
              transferPairId: null,
            },
          ]
        : [],
    asOfIso: "2026-01-10T00:00:00Z",
  });
  return {
    plan: row,
    calculations: serializePlanCalculations(calculations),
    itemCount: 0,
    transactionCount: opts.spentMinor != null ? 1 : 0,
  };
}

describe("<PlansGrid> — empty state", () => {
  it("has no axe violations", async () => {
    const { container } = render(<PlansGrid initialPlans={[]} masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an honest empty state with the product-model messaging, not fabricated plans", () => {
    render(<PlansGrid initialPlans={[]} masked={false} />);
    expect(screen.getByText(/no plans yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/real-life purposes/i).length).toBeGreaterThan(0);
  });

  it("opens the create sheet from the empty state's action", async () => {
    const user = userEvent.setup();
    render(<PlansGrid initialPlans={[]} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Create your first Plan" }));
    expect(screen.getByRole("heading", { name: "Create a Plan" })).toBeInTheDocument();
  });
});

describe("<PlansGrid> — populated", () => {
  it("has no axe violations", async () => {
    const plans = [withSummary(planRow())];
    const { container } = render(<PlansGrid initialPlans={plans} masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders a no-budget Plan as tracking-only", () => {
    const plans = [withSummary(planRow(), { spentMinor: 500000 })];
    render(<PlansGrid initialPlans={plans} masked={false} />);
    expect(screen.getByText(/tracking spend only/i)).toBeInTheDocument();
  });

  it("renders a budgeted Plan's progress bar and doesn't claim over-budget when under", () => {
    const plans = [withSummary(planRow(), { budgetMinor: 10000000, spentMinor: 500000 })];
    render(<PlansGrid initialPlans={plans} masked={false} />);
    expect(screen.queryByText(/over budget/i)).not.toBeInTheDocument();
  });

  it("shows a calm 'Over budget' label (not alarmist) when spend exceeds budget", () => {
    const plans = [withSummary(planRow(), { budgetMinor: 100000, spentMinor: 500000 })];
    render(<PlansGrid initialPlans={plans} masked={false} />);
    expect(screen.getByText("Over budget")).toBeInTheDocument();
  });

  it("filters the grid by search term", async () => {
    const user = userEvent.setup();
    const plans = [
      withSummary(planRow({ id: "p1", name: "Thailand Trip" })),
      withSummary(planRow({ id: "p2", name: "Home Renovation" })),
    ];
    render(<PlansGrid initialPlans={plans} masked={false} />);
    await user.type(screen.getByLabelText("Search Plans"), "renovation");
    expect(screen.queryByText("Thailand Trip")).not.toBeInTheDocument();
    expect(screen.getByText("Home Renovation")).toBeInTheDocument();
  });

  it("masks amounts when Privacy Mode is on", () => {
    const plans = [withSummary(planRow(), { budgetMinor: 10000000, spentMinor: 500000 })];
    render(<PlansGrid initialPlans={plans} masked />);
    expect(screen.getAllByText("₹***").length).toBeGreaterThan(0);
  });
});

describe("<PlansGrid> — date display (Gate 5 §5/§9)", () => {
  it("hides the date line entirely for a dateless Plan, never showing '-'/'N/A'", () => {
    const plans = [withSummary(planRow())];
    render(<PlansGrid initialPlans={plans} masked={false} />);
    expect(screen.queryByText("-")).not.toBeInTheDocument();
    expect(screen.queryByText(/n\/a/i)).not.toBeInTheDocument();
  });

  it("shows a formatted date range when both dates are set", () => {
    const plans = [withSummary(planRow({ start_date: "2026-12-01", end_date: "2026-12-15" }))];
    render(<PlansGrid initialPlans={plans} masked={false} />);
    expect(screen.getByText(/Dec 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Dec 15, 2026/)).toBeInTheDocument();
  });
});
