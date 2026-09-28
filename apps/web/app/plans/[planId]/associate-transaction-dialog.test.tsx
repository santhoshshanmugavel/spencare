import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanItemRow, TransactionRow } from "@spencare/domain-application";
import { AssociateTransactionDialog } from "./associate-transaction-dialog";

vi.mock("../actions", () => ({
  searchTransactionsForPlanAction: vi.fn(async () => []),
  setTransactionPlanAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

const PLAN_ID = "plan-1";

function txn(overrides: Partial<TransactionRow> = {}): TransactionRow {
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
    plan_id: null,
    plan_item_id: null,
    created_at: "2026-01-05T00:00:00Z",
    updated_at: "2026-01-05T00:00:00Z",
    ...overrides,
  };
}

const items: PlanItemRow[] = [
  {
    id: "item-1",
    plan_id: PLAN_ID,
    user_id: "u1",
    name: "Flights",
    description: null,
    category_id: null,
    estimated_amount_minor: null,
    estimated_currency: null,
    status: "planned",
    expected_date: null,
    commitment_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

beforeEach(async () => {
  const { searchTransactionsForPlanAction, setTransactionPlanAction } = await import("../actions");
  vi.mocked(searchTransactionsForPlanAction).mockReset();
  vi.mocked(setTransactionPlanAction).mockReset();
  vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([txn()]);
  vi.mocked(setTransactionPlanAction).mockResolvedValue({ ok: true, value: {} as never });
});

describe("<AssociateTransactionDialog> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<AssociateTransactionDialog> — search and select", () => {
  it("lists matching transactions and never claims to change their amount", async () => {
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText("Thai Airways")).toBeInTheDocument();
    expect(screen.getByText(/never change/i)).toBeInTheDocument();
  });

  it("attaches the selected transaction, optionally scoped to a Plan item, without altering its financial fields", async () => {
    const { setTransactionPlanAction } = await import("../actions");
    const onAssociated = vi.fn();
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={onAssociated} />,
    );
    await user.click(await screen.findByText("Thai Airways"));
    await user.click(screen.getByLabelText("Optionally attach to a Plan item"));
    await user.click(await screen.findByRole("option", { name: "Flights" }));
    await user.click(screen.getByRole("button", { name: "Attach transaction" }));
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-1", { planId: PLAN_ID, planItemId: "item-1" });
    expect(onAssociated).toHaveBeenCalledTimes(1);
  });

  it("flags a currency-mismatched transaction rather than silently allowing or converting it", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([txn({ id: "txn-usd", currency: "USD", merchant: "Amazon US" })]);
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText(/different currency/i)).toBeInTheDocument();
  });

  it("shows an honest empty state when nothing matches", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([]);
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText(/no matching transactions/i)).toBeInTheDocument();
  });

  it("disables the attach button until a transaction is selected", () => {
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Attach transaction" })).toBeDisabled();
  });
});

describe("<AssociateTransactionDialog> — reassignment is explicit, never silent (Gate 6 §38/§39)", () => {
  it("labels a transaction already attached to another Plan, and switches the button to an explicit 'move' label", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([txn({ plan_id: "other-plan" })]);
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText(/attached to another plan/i)).toBeInTheDocument();
    await user.click(screen.getByText("Thai Airways"));
    expect(screen.getByText(/continuing will move it here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to this Plan" })).toBeEnabled();
  });

  it("confirms a reassignment with a distinct toast wording from a fresh attach", async () => {
    const { searchTransactionsForPlanAction, setTransactionPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([txn({ plan_id: "other-plan" })]);
    const onAssociated = vi.fn();
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={onAssociated} />,
    );
    await user.click(await screen.findByText("Thai Airways"));
    await user.click(screen.getByRole("button", { name: "Move to this Plan" }));
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-1", { planId: PLAN_ID, planItemId: null });
    expect(onAssociated).toHaveBeenCalledTimes(1);
  });
});
