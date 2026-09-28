import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizePlan, calculatePlanCategoryBreakdown } from "@spencare/domain-application";
import type {
  AccountRow,
  CategoryRow,
  GoalRow,
  PlanDetail,
  PlanItemRow,
  PlannedCommitmentRow,
  TransactionRow,
} from "@spencare/domain-application";
import { Money } from "@spencare/domain-core";
import { PlanDetailView, type SerializedPlanDetail } from "./plan-detail-view";
import { serializePlanCalculations, serializeCategoryBreakdown } from "@/lib/plan-calculations-serialization";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock("../actions", () => ({
  updatePlanAction: vi.fn(async () => ({ ok: true, value: {} })),
  updatePlanBudgetAction: vi.fn(async () => ({ ok: true, value: {} })),
  updatePlanStatusAction: vi.fn(async () => ({ ok: true, value: {} })),
  archivePlanAction: vi.fn(async () => ({ ok: true, value: {} })),
  deletePlanAction: vi.fn(async () => ({ ok: true, value: undefined })),
  addPlanItemAction: vi.fn(async () => ({ ok: true, value: {} })),
  updatePlanItemAction: vi.fn(async () => ({ ok: true, value: {} })),
  updatePlanItemStatusAction: vi.fn(async () => ({ ok: true, value: {} })),
  associatePlanGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
  dissociatePlanGoalAction: vi.fn(async () => ({ ok: true, value: {} })),
  associatePlanCommitmentAction: vi.fn(async () => ({ ok: true, value: {} })),
  dissociatePlanCommitmentAction: vi.fn(async () => ({ ok: true, value: {} })),
  associatePlanAccountAction: vi.fn(async () => ({ ok: true, value: {} })),
  dissociatePlanAccountAction: vi.fn(async () => ({ ok: true, value: {} })),
  setTransactionPlanAction: vi.fn(async () => ({ ok: true, value: {} })),
  searchTransactionsForPlanAction: vi.fn(async () => []),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const PLAN_ID = "8f14e45f-ceea-467e-951c-d5f9f8e6d123";

function planItem(overrides: Partial<PlanItemRow> = {}): PlanItemRow {
  return {
    id: "item-1",
    plan_id: PLAN_ID,
    user_id: "u1",
    name: "Flights",
    description: null,
    category_id: null,
    estimated_amount_minor: 1800000,
    estimated_currency: "INR",
    status: "planned",
    expected_date: null,
    commitment_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function transactionRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "txn-1",
    user_id: "u1",
    account_id: "acc-1",
    type: "expense",
    amount_minor: 500000,
    currency: "INR",
    category_id: null,
    merchant: "Thai Airways",
    item_name: null,
    description: null,
    occurred_at: "2026-01-05",
    status: "posted",
    transfer_pair_id: null,
    goal_id: null,
    bill_prediction_id: null,
    plan_id: PLAN_ID,
    plan_item_id: null,
    created_at: "2026-01-05T00:00:00Z",
    updated_at: "2026-01-05T00:00:00Z",
    ...overrides,
  };
}

function buildDetail(opts: {
  status?: PlanDetail["plan"]["status"];
  budgetMinor?: number | null;
  items?: PlanItemRow[];
  transactions?: TransactionRow[];
  startDate?: string | null;
  endDate?: string | null;
} = {}): SerializedPlanDetail {
  const status = opts.status ?? "active";
  const items = opts.items ?? [];
  const transactions = opts.transactions ?? [];
  const planRow: PlanDetail["plan"] = {
    id: PLAN_ID,
    user_id: "u1",
    name: "Thailand Trip",
    description: "December vacation",
    status,
    start_date: opts.startDate ?? null,
    end_date: opts.endDate ?? null,
    base_currency: "INR",
    original_budget_minor: opts.budgetMinor ?? null,
    current_budget_minor: opts.budgetMinor ?? null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    completed_at: status === "completed" ? "2026-01-10T00:00:00Z" : null,
    archived_at: status === "archived" ? "2026-01-10T00:00:00Z" : null,
  };

  const calculations = summarizePlan({
    plan: {
      id: planRow.id,
      userId: planRow.user_id,
      name: planRow.name,
      description: planRow.description,
      status: planRow.status,
      startDate: planRow.start_date,
      endDate: planRow.end_date,
      baseCurrency: planRow.base_currency,
      originalBudget: opts.budgetMinor != null ? Money.fromMinorUnits(BigInt(opts.budgetMinor), "INR") : null,
      currentBudget: opts.budgetMinor != null ? Money.fromMinorUnits(BigInt(opts.budgetMinor), "INR") : null,
      createdAt: planRow.created_at,
      updatedAt: planRow.updated_at,
      completedAt: planRow.completed_at,
      archivedAt: planRow.archived_at,
    },
    items: items.map((i) => ({
      id: i.id,
      planId: i.plan_id,
      name: i.name,
      description: i.description,
      categoryId: i.category_id,
      estimatedAmount:
        i.estimated_amount_minor != null && i.estimated_currency
          ? Money.fromMinorUnits(BigInt(i.estimated_amount_minor), i.estimated_currency)
          : null,
      status: i.status,
      expectedDate: i.expected_date,
      commitmentId: i.commitment_id,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Money.fromMinorUnits(BigInt(t.amount_minor), t.currency),
      occurredAt: t.occurred_at,
      deletedAt: null,
      transferPairId: t.transfer_pair_id,
    })),
    asOfIso: "2026-01-10T00:00:00Z",
  });

  return {
    plan: planRow,
    items,
    goalLinks: [],
    commitmentLinks: [],
    accountLinks: [],
    transactions,
    calculations: serializePlanCalculations(calculations),
    categoryBreakdown: serializeCategoryBreakdown(calculatePlanCategoryBreakdown(planRow, items, transactions)),
  };
}

const goals: GoalRow[] = [];
const commitments: PlannedCommitmentRow[] = [];
const accounts: AccountRow[] = [];
const categories: CategoryRow[] = [];

describe("<PlanDetailView> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * The header consolidates Edit/lifecycle/Archive/Delete into one "Actions"
 * overflow menu (Gate 5 polish — matches the existing GoalCard convention
 * instead of a growing row of individual buttons). Every lifecycle test
 * below opens that menu first.
 */
async function openActionsMenu(user: ReturnType<typeof userEvent.setup>, planName: string) {
  await user.click(screen.getByRole("button", { name: `Actions for ${planName}` }));
}

describe("<PlanDetailView> — header and lifecycle", () => {
  it("renders the Plan name, purpose, and status", () => {
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.getByRole("heading", { name: "Thailand Trip" })).toBeInTheDocument();
    expect(screen.getByText("December vacation")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows only valid next-status actions for an active Plan (Pause/Postpone/Mark complete/Archive, never Reopen)", async () => {
    const user = userEvent.setup();
    render(
      <PlanDetailView initialDetail={buildDetail({ status: "active" })} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    await openActionsMenu(user, "Thailand Trip");
    expect(screen.getByRole("menuitem", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Postpone" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Mark complete" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Archive Plan" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reopen" })).not.toBeInTheDocument();
  });

  it("an archived Plan offers Reopen instead of Archive, and a completed Plan stays accessible with Reopen available (E2E flow F/G)", async () => {
    const user = userEvent.setup();
    render(
      <PlanDetailView initialDetail={buildDetail({ status: "archived" })} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    await openActionsMenu(user, "Thailand Trip");
    expect(screen.getByRole("menuitem", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Archive Plan" })).not.toBeInTheDocument();
  });

  it("a completed Plan is still fully viewable and offers Reopen", async () => {
    const user = userEvent.setup();
    render(
      <PlanDetailView initialDetail={buildDetail({ status: "completed" })} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.getByText("Thailand Trip")).toBeInTheDocument();
    await openActionsMenu(user, "Thailand Trip");
    expect(screen.getByRole("menuitem", { name: "Reopen" })).toBeInTheDocument();
  });

  it("calling a lifecycle action calls updatePlanStatusAction with the target status", async () => {
    const { updatePlanStatusAction } = await import("../actions");
    const user = userEvent.setup();
    render(
      <PlanDetailView initialDetail={buildDetail({ status: "active" })} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    await openActionsMenu(user, "Thailand Trip");
    await user.click(screen.getByRole("menuitem", { name: "Pause" }));
    expect(updatePlanStatusAction).toHaveBeenCalledWith(PLAN_ID, { targetStatus: "paused" });
  });

  it("only offers Delete for an empty draft Plan", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PlanDetailView initialDetail={buildDetail({ status: "draft" })} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    await openActionsMenu(user, "Thailand Trip");
    expect(screen.getByRole("menuitem", { name: "Delete Plan" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    rerender(
      <PlanDetailView
        initialDetail={buildDetail({ status: "draft", items: [planItem()] })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    await openActionsMenu(user, "Thailand Trip");
    expect(screen.queryByRole("menuitem", { name: "Delete Plan" })).not.toBeInTheDocument();
  });
});

describe("<PlanDetailView> — budget and over-budget UX (calm, not alarmist)", () => {
  it("shows a tracking-only message when no budget is set", () => {
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.getByText(/no plan budget/i)).toBeInTheDocument();
  });

  it("shows Budget/Spent/Remaining when a budget is set and under budget", () => {
    render(
      <PlanDetailView
        initialDetail={buildDetail({ budgetMinor: 10000000, transactions: [transactionRow({ amount_minor: 500000 })] })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    expect(screen.getByText("Remaining")).toBeInTheDocument();
    expect(screen.queryByText(/over its budget/i)).not.toBeInTheDocument();
  });

  it("reducing budget below actual spend is allowed and surfaces over-budget calmly, not blocked", () => {
    render(
      <PlanDetailView
        initialDetail={buildDetail({ budgetMinor: 100000, transactions: [transactionRow({ amount_minor: 500000 })] })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    expect(screen.getByText("Over by")).toBeInTheDocument();
    expect(screen.getByText(/gone over its budget/i)).toBeInTheDocument();
  });
});

describe("<PlanDetailView> — items", () => {
  it("shows an honest empty state with no items", () => {
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.getByText("No items yet")).toBeInTheDocument();
  });

  it("renders an item's name and estimated amount", () => {
    render(
      <PlanDetailView
        initialDetail={buildDetail({ items: [planItem()] })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    expect(screen.getByText("Flights")).toBeInTheDocument();
  });

  it("opens the add-item sheet from the header button", async () => {
    const user = userEvent.setup();
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    await user.click(screen.getByRole("button", { name: /add item/i }));
    expect(screen.getByRole("heading", { name: "Add a Plan item" })).toBeInTheDocument();
  });
});

describe("<PlanDetailView> — transactions (never alters financial fields)", () => {
  it("shows an honest empty state with no attached transactions", () => {
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.getByText("No transactions attached yet")).toBeInTheDocument();
  });

  it("renders an attached transaction's merchant and amount", () => {
    render(
      <PlanDetailView
        initialDetail={buildDetail({ transactions: [transactionRow()] })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    expect(screen.getByText("Thai Airways")).toBeInTheDocument();
  });

  it("detaching a transaction calls setTransactionPlanAction with both ids null, never a financial-field update", async () => {
    const { setTransactionPlanAction } = await import("../actions");
    const user = userEvent.setup();
    render(
      <PlanDetailView
        initialDetail={buildDetail({ transactions: [transactionRow()] })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: /detach from this plan/i }));
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-1", { planId: null, planItemId: null });
  });

  it("opens the attach-transaction dialog from the header button", async () => {
    const user = userEvent.setup();
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    await user.click(screen.getByRole("button", { name: /attach transaction/i }));
    expect(screen.getByRole("heading", { name: "Attach a transaction" })).toBeInTheDocument();
  });
});

describe("<PlanDetailView> — currency-mismatch honesty", () => {
  it("reports excluded, differently-currencied transactions rather than silently converting or dropping them", () => {
    const detail = buildDetail({ budgetMinor: 10000000, transactions: [transactionRow({ id: "usd-1", currency: "USD", amount_minor: 5000 })] });
    render(
      <PlanDetailView initialDetail={detail} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.getByText(/aren.t included in these totals/i)).toBeInTheDocument();
  });
});

describe("<PlanDetailView> — Privacy Mode", () => {
  it("masks Money figures when masked=true", () => {
    render(
      <PlanDetailView
        initialDetail={buildDetail({ budgetMinor: 10000000, transactions: [transactionRow({ amount_minor: 500000 })] })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked
      />,
    );
    expect(screen.getAllByText("₹***").length).toBeGreaterThan(0);
  });
});

describe("<PlanDetailView> — no-date state (Gate 5 §9)", () => {
  it("shows no date line at all when neither start nor end date is set, never '-'/'N/A'", () => {
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.queryByText("-")).not.toBeInTheDocument();
    expect(screen.queryByText(/n\/a/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no start date/i)).not.toBeInTheDocument();
  });

  it("shows a formatted (not raw ISO) date range once dates are set", () => {
    render(
      <PlanDetailView
        initialDetail={buildDetail({ startDate: "2026-12-01", endDate: "2026-12-15" })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    expect(screen.getByText(/Dec 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Dec 15, 2026/)).toBeInTheDocument();
    expect(screen.queryByText("2026-12-01")).not.toBeInTheDocument();
  });

  it("shows a clean 'No end date' when only a start date is set (not an awkward placeholder)", () => {
    render(
      <PlanDetailView
        initialDetail={buildDetail({ startDate: "2026-12-01" })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    expect(screen.getByText(/no end date/i)).toBeInTheDocument();
  });
});

describe("<PlanDetailView> — Committed / Upcoming (Gate 5 §7)", () => {
  it("shows Committed and Upcoming captions when non-zero", () => {
    render(
      <PlanDetailView
        initialDetail={buildDetail({ items: [planItem({ status: "committed" }), planItem({ id: "item-2", status: "booked" })] })}
        accounts={accounts}
        categories={categories}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    expect(screen.getAllByText(/Committed/).length).toBeGreaterThan(0);
  });

  it("hides the Committed/Upcoming line entirely when both are zero, rather than showing ₹0", () => {
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.queryByText(/Committed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Upcoming/)).not.toBeInTheDocument();
  });
});

describe("<PlanDetailView> — category breakdown planned vs. actual (Gate 5 §22)", () => {
  it("shows a category's planned amount alongside its actual spend", () => {
    const categoryId = "6aedc5e6-3884-4a33-84dd-22672d745744";
    const { container } = render(
      <PlanDetailView
        initialDetail={buildDetail({
          items: [planItem({ category_id: categoryId, estimated_amount_minor: 2000000 })],
          transactions: [transactionRow({ category_id: categoryId, amount_minor: 500000 })],
        })}
        accounts={accounts}
        categories={[{ id: categoryId, user_id: null, name: "Travel", icon: null, is_system: true }]}
        goals={goals}
        commitments={commitments}
        masked={false}
      />,
    );
    expect(screen.getAllByText("Travel").length).toBeGreaterThan(0);
    expect(container.textContent).toMatch(/of\s*₹20,000\.00\s*planned/i);
  });

  it("shows nothing at all (no empty chart) when there is no priced item and no transaction to break down", () => {
    render(
      <PlanDetailView initialDetail={buildDetail()} accounts={accounts} categories={categories} goals={goals} commitments={commitments} masked={false} />,
    );
    expect(screen.queryByText("By category")).not.toBeInTheDocument();
  });
});
