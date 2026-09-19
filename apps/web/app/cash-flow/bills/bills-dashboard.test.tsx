import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, BillDefinitionRow, BillPredictionWithDefinition, CategoryRow } from "@spencare/domain-application";
import { BillsDashboard } from "./bills-dashboard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const billDefinition: BillDefinitionRow = {
  id: "bill-1",
  user_id: "user-a",
  merchant_pattern: "Netflix",
  category_id: null,
  expected_amount_minor: 49900,
  expected_amount_tolerance_pct: null,
  recurrence_interval: "monthly",
  detection_source: "manual",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

vi.mock("./actions", () => ({
  createBillAction: vi.fn(async () => ({ ok: true, value: {} })),
  updateBillAction: vi.fn(async () => ({ ok: true, value: {} })),
  deleteBillAction: vi.fn(async () => ({ ok: true, value: undefined })),
  markPaidAction: vi.fn(async () => ({ ok: true, value: {} })),
  undoPaidAction: vi.fn(async () => ({ ok: true, value: undefined })),
  getBillAction: vi.fn(async () => ({ ...billDefinition })),
}));

beforeEach(async () => {
  refresh.mockReset();
  const actions = await import("./actions");
  vi.mocked(actions.undoPaidAction).mockReset();
  vi.mocked(actions.undoPaidAction).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(actions.getBillAction).mockReset();
  vi.mocked(actions.getBillAction).mockResolvedValue({ ...billDefinition });
});

const accounts: AccountRow[] = [
  {
    id: "acc-1",
    user_id: "user-a",
    type: "bank",
    name: "HDFC Bank",
    currency: "INR",
    balance_minor: 1000000,
    credit_limit_minor: null,
    credit_used_minor: null,
    market_value_minor: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    statement_generated_day: null,
    payment_due_day: null,
  },
];

const categories: CategoryRow[] = [
  { id: "289f5e56-21a8-4ee0-865f-c02c11f4d874", user_id: null, name: "Bills & Utilities", icon: "receipt", is_system: true },
];

function prediction(overrides: Partial<BillPredictionWithDefinition> = {}): BillPredictionWithDefinition {
  return {
    id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
    bill_definition_id: "bill-1",
    user_id: "user-a",
    expected_date: "2026-09-15",
    expected_amount_minor: 49900,
    status: "open",
    matched_transaction_id: null,
    matched_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: null },
    matched_transaction: null,
    ...overrides,
  };
}

describe("<BillsDashboard> — empty state", () => {
  it("has no axe violations", async () => {
    const { container } = render(<BillsDashboard initialPredictions={[]} accounts={accounts} categories={categories} masked={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an honest empty state, not fabricated bills", () => {
    render(<BillsDashboard initialPredictions={[]} accounts={accounts} categories={categories} masked={false} />);
    expect(screen.getByText(/no bills yet/i)).toBeInTheDocument();
  });
});

describe("<BillsDashboard> — populated", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <BillsDashboard initialPredictions={[prediction()]} accounts={accounts} categories={categories} masked={false} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an upcoming bill under 'Upcoming' with a persistent, always-visible Bill Now button (not hover-gated, per the mobile requirement)", () => {
    render(<BillsDashboard initialPredictions={[prediction()]} accounts={accounts} categories={categories} masked={false} />);
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    const billNowButton = screen.getByRole("button", { name: "Bill Now" });
    // Not inside a `hidden`/hover-only wrapper -- directly queryable and
    // visible, same assertion style as GoalCard's own persistent-button
    // test precedent.
    expect(billNowButton).toBeVisible();
  });

  it("groups a matched bill under 'Paid' with a persistent Undo button, distinct from an open bill's Bill Now", () => {
    render(
      <BillsDashboard
        initialPredictions={[prediction({ id: "pred-2", status: "matched", matched_transaction_id: "txn-1" })]}
        accounts={accounts}
        categories={categories}
        masked={false}
      />,
    );
    // "Paid" legitimately appears twice -- the section heading and the
    // CF-D11 status badge on the row itself -- both real, both expected.
    expect(screen.getByRole("heading", { name: "Paid" })).toBeInTheDocument();
    expect(screen.getAllByText("Paid").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Bill Now" })).not.toBeInTheDocument();
  });

  it("shows CF-D11's distinct status text for open vs. overdue vs. matched, not color alone", () => {
    render(
      <BillsDashboard
        initialPredictions={[
          prediction({ id: "p-open", status: "open" }),
          prediction({ id: "p-overdue", status: "overdue", expected_date: "2026-08-01" }),
          prediction({ id: "p-matched", status: "matched", matched_transaction_id: "t", expected_date: "2026-07-01" }),
        ]}
        accounts={accounts}
        categories={categories}
        masked={false}
      />,
    );
    // The open row's "Due 15 Sept" legitimately appears twice (row
    // subtitle + CF-D11 badge) -- both real, both expected; "Overdue" and
    // "Paid" are each unique to their own badge/heading.
    expect(screen.getAllByText(/due 15 sep/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paid" })).toBeInTheDocument();
  });

  it("REGRESSION (real defect found live): a matched row shows the REAL settled amount, not the stale predicted amount, when the user paid a different real figure", () => {
    render(
      <BillsDashboard
        initialPredictions={[
          prediction({
            status: "matched",
            matched_transaction_id: "txn-1",
            expected_amount_minor: 49900, // predicted 499.00
            matched_transaction: { amount_minor: 52000 }, // actually paid 520.00
          }),
        ]}
        accounts={accounts}
        categories={categories}
        masked={false}
      />,
    );
    expect(screen.getByText("₹520.00")).toBeInTheDocument();
    expect(screen.queryByText("₹499.00")).not.toBeInTheDocument();
  });

  it("clicking Bill Now opens the payment sheet for that prediction", async () => {
    const user = userEvent.setup();
    render(<BillsDashboard initialPredictions={[prediction()]} accounts={accounts} categories={categories} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Bill Now" }));
    expect(screen.getByText(/Bill Now: Netflix/i)).toBeInTheDocument();
  });

  it("clicking Undo calls undoPaidAction directly for that prediction and refreshes on success", async () => {
    const actions = await import("./actions");
    const user = userEvent.setup();
    render(
      <BillsDashboard
        initialPredictions={[prediction({ status: "matched", matched_transaction_id: "txn-1" })]}
        accounts={accounts}
        categories={categories}
        masked={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(actions.undoPaidAction).toHaveBeenCalledWith("8cad1f12-3b01-4a55-9aa9-3ce1fef58491");
    expect(refresh).toHaveBeenCalled();
  });

  it("clicking Edit fetches the full bill definition and opens the edit sheet", async () => {
    const actions = await import("./actions");
    const user = userEvent.setup();
    render(<BillsDashboard initialPredictions={[prediction()]} accounts={accounts} categories={categories} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(actions.getBillAction).toHaveBeenCalledWith("bill-1");
    expect(await screen.findByText("Edit Netflix")).toBeInTheDocument();
  });

  it("clicking Delete fetches the full bill definition and opens the delete confirmation", async () => {
    const user = userEvent.setup();
    render(<BillsDashboard initialPredictions={[prediction()]} accounts={accounts} categories={categories} masked={false} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
