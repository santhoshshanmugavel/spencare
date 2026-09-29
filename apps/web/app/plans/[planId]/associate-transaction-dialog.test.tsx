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
    await screen.findByText("Thai Airways");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<AssociateTransactionDialog> — search and multi-select", () => {
  it("lists matching transactions and never claims to change their amount", async () => {
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText("Thai Airways")).toBeInTheDocument();
    expect(screen.getByText(/never change/i)).toBeInTheDocument();
  });

  it("disables the attach button until at least one transaction is selected", async () => {
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await screen.findByText("Thai Airways");
    expect(screen.getByRole("button", { name: "Attach selected transactions" })).toBeDisabled();
  });

  it("selects multiple transactions, shows a live selection count, and keeps prior selections checked", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([
      txn({ id: "txn-1", merchant: "Thai Airways" }),
      txn({ id: "txn-2", merchant: "Grab Taxi" }),
    ]);
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    const first = await screen.findByRole("checkbox", { name: /select thai airways/i });
    const second = screen.getByRole("checkbox", { name: /select grab taxi/i });

    await user.click(first);
    expect(screen.getByText("1 transaction selected")).toBeInTheDocument();
    expect(first).toHaveAttribute("data-state", "checked");

    await user.click(second);
    expect(screen.getByText("2 transactions selected")).toBeInTheDocument();
    expect(first).toHaveAttribute("data-state", "checked");
    expect(second).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("button", { name: "Attach selected transactions" })).toBeEnabled();
  });

  it("preserves selections when the search query changes", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([txn({ id: "txn-1", merchant: "Thai Airways" })]);
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select thai airways/i }));
    expect(screen.getByText("1 transaction selected")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search transactions"), "thai");
    expect(screen.getByText("1 transaction selected")).toBeInTheDocument();
  });

  it("attaches every selected transaction, optionally scoped to a Plan item, without altering financial fields", async () => {
    const { searchTransactionsForPlanAction, setTransactionPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([
      txn({ id: "txn-1", merchant: "Thai Airways" }),
      txn({ id: "txn-2", merchant: "Grab Taxi" }),
    ]);
    const onAssociated = vi.fn();
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={onAssociated} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select thai airways/i }));
    await user.click(screen.getByRole("checkbox", { name: /select grab taxi/i }));
    await user.click(screen.getByLabelText("Optionally attach to a Plan item"));
    await user.click(await screen.findByRole("option", { name: "Flights" }));
    await user.click(screen.getByRole("button", { name: "Attach selected transactions" }));

    expect(setTransactionPlanAction).toHaveBeenCalledTimes(2);
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-1", { planId: PLAN_ID, planItemId: "item-1" });
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-2", { planId: PLAN_ID, planItemId: "item-1" });
    expect(onAssociated).toHaveBeenCalledTimes(1);
  });

  it("does not call the attach action more than once per selected transaction (no duplicate associations)", async () => {
    const { searchTransactionsForPlanAction, setTransactionPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([txn({ id: "txn-1", merchant: "Thai Airways" })]);
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    const checkbox = await screen.findByRole("checkbox", { name: /select thai airways/i });
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Attach selected transactions" }));
    expect(setTransactionPlanAction).toHaveBeenCalledTimes(1);
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
});

describe("<AssociateTransactionDialog> — reassignment is explicit, never silent (Gate 6 §38/§39)", () => {
  it("labels a transaction already attached to another Plan and warns before moving it", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([txn({ plan_id: "other-plan" })]);
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText(/attached to another plan/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /select thai airways/i }));
    expect(screen.getByText(/continuing will move it here instead/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach selected transactions" })).toBeEnabled();
  });

  it("warns with a plural count when multiple selected transactions are already attached elsewhere", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([
      txn({ id: "txn-1", merchant: "Thai Airways", plan_id: "other-plan" }),
      txn({ id: "txn-2", merchant: "Grab Taxi", plan_id: "other-plan" }),
    ]);
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select thai airways/i }));
    await user.click(screen.getByRole("checkbox", { name: /select grab taxi/i }));
    expect(screen.getByText(/2 selected transactions are/i)).toBeInTheDocument();
    expect(screen.getByText(/continuing will move them here instead/i)).toBeInTheDocument();
  });

  it("confirms a reassignment with distinct wording naming the moved transaction", async () => {
    const { searchTransactionsForPlanAction, setTransactionPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue([txn({ plan_id: "other-plan" })]);
    const onAssociated = vi.fn();
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={onAssociated} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select thai airways/i }));
    await user.click(screen.getByRole("button", { name: "Attach selected transactions" }));
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-1", { planId: PLAN_ID, planItemId: null });
    expect(onAssociated).toHaveBeenCalledTimes(1);
  });
});
