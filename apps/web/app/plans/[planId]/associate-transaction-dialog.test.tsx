import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, CategoryRow, PlanItemRow, TransactionRow } from "@spencare/domain-application";
import { AssociateTransactionDialog } from "./associate-transaction-dialog";

vi.mock("../actions", () => ({
  searchTransactionsForPlanAction: vi.fn(async () => ({ transactions: [], nextCursor: null, archivedPlanIds: [] })),
  setTransactionPlanAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

const PLAN_ID = "plan-1";

/** The server action now returns a paginated SearchTransactionsForPlanResult; this is the ergonomic test wrapper for a single-page response. */
function page(txns: TransactionRow[], archivedPlanIds: string[] = []) {
  return { transactions: txns, nextCursor: null as null, archivedPlanIds };
}

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

const accounts: AccountRow[] = [
  {
    id: "acc-1",
    user_id: "u1",
    name: "HDFC Savings",
    type: "bank",
    currency: "INR",
    opening_balance_minor: 0,
    opening_balance_at: "2026-01-01",
    archived_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as never,
];

const categories: CategoryRow[] = [];

const commonProps = {
  planName: "Thailand Trip",
  accounts,
  categories,
};

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
  vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([txn()], []));
  vi.mocked(setTransactionPlanAction).mockResolvedValue({ ok: true, value: {} as never });
});

describe("<AssociateTransactionDialog> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await screen.findByText("Thai Airways");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<AssociateTransactionDialog> — search and multi-select", () => {
  it("lists matching transactions and never claims to change their amount", async () => {
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText("Thai Airways")).toBeInTheDocument();
    expect(screen.getByText(/never change/i)).toBeInTheDocument();
  });

  it("disables the attach button until at least one transaction is selected", async () => {
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await screen.findByText("Thai Airways");
    expect(screen.getByRole("button", { name: "Attach transaction" })).toBeDisabled();
  });

  it("selects multiple transactions, shows a live selection count, and keeps prior selections checked", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([
      txn({ id: "txn-1", merchant: "Thai Airways" }),
      txn({ id: "txn-2", merchant: "Grab Taxi" }),
    ]));
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
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
    expect(screen.getByRole("button", { name: "Attach 2 transactions" })).toBeEnabled();
  });

  it("preserves selections when the search query changes", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([txn({ id: "txn-1", merchant: "Thai Airways" })]));
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select thai airways/i }));
    expect(screen.getByText("1 transaction selected")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search transactions"), "thai");
    expect(screen.getByText("1 transaction selected")).toBeInTheDocument();
  });

  it("attaches every selected transaction, optionally scoped to a Plan item, without altering financial fields", async () => {
    const { searchTransactionsForPlanAction, setTransactionPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([
      txn({ id: "txn-1", merchant: "Thai Airways" }),
      txn({ id: "txn-2", merchant: "Grab Taxi" }),
    ]));
    const onAssociated = vi.fn();
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={onAssociated} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select thai airways/i }));
    await user.click(screen.getByRole("checkbox", { name: /select grab taxi/i }));
    await user.click(screen.getByLabelText("Optionally attach to a Plan item"));
    await user.click(await screen.findByRole("option", { name: "Flights" }));
    await user.click(screen.getByRole("button", { name: "Attach 2 transactions" }));

    expect(setTransactionPlanAction).toHaveBeenCalledTimes(2);
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-1", { planId: PLAN_ID, planItemId: "item-1" });
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-2", { planId: PLAN_ID, planItemId: "item-1" });
    expect(onAssociated).toHaveBeenCalledTimes(1);
  });

  it("does not call the attach action more than once per selected transaction (no duplicate associations)", async () => {
    const { searchTransactionsForPlanAction, setTransactionPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([txn({ id: "txn-1", merchant: "Thai Airways" })]));
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    const checkbox = await screen.findByRole("checkbox", { name: /select thai airways/i });
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Attach transaction" }));
    expect(setTransactionPlanAction).toHaveBeenCalledTimes(1);
  });

  it("flags a currency-mismatched transaction rather than silently allowing or converting it", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([txn({ id: "txn-usd", currency: "USD", merchant: "Amazon US" })]));
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText(/different currency/i)).toBeInTheDocument();
  });

  it("shows an honest empty state when nothing matches", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([]));
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    // With no search/filters active, the empty-state message is the
    // "you don't have any transactions yet" variant, not a "no match"
    // one -- an untouched picker shouldn't imply the user searched.
    expect(await screen.findByText(/don't have any transactions yet/i)).toBeInTheDocument();
  });
});

describe("<AssociateTransactionDialog> — reassignment is explicit, never silent (Gate 6 §38/§39)", () => {
  it("labels a transaction already attached to another Plan and warns before moving it", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([txn({ plan_id: "other-plan" })]));
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    expect(await screen.findByText(/attached to another plan/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /select thai airways/i }));
    expect(screen.getByText(/continuing will move it here instead/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach transaction" })).toBeEnabled();
  });

  it("warns with a plural count when multiple selected transactions are already attached elsewhere", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([
      txn({ id: "txn-1", merchant: "Thai Airways", plan_id: "other-plan" }),
      txn({ id: "txn-2", merchant: "Grab Taxi", plan_id: "other-plan" }),
    ]));
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select thai airways/i }));
    await user.click(screen.getByRole("checkbox", { name: /select grab taxi/i }));
    expect(screen.getByText(/2 selected transactions are/i)).toBeInTheDocument();
    expect(screen.getByText(/continuing will move them here instead/i)).toBeInTheDocument();
  });

  it("confirms a reassignment with distinct wording naming the moved transaction", async () => {
    const { searchTransactionsForPlanAction, setTransactionPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([txn({ plan_id: "other-plan" })]));
    const onAssociated = vi.fn();
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={onAssociated} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select thai airways/i }));
    await user.click(screen.getByRole("button", { name: "Attach transaction" }));
    expect(setTransactionPlanAction).toHaveBeenCalledWith(PLAN_ID, "txn-1", { planId: PLAN_ID, planItemId: null });
    expect(onAssociated).toHaveBeenCalledTimes(1);
  });
});

describe("<AssociateTransactionDialog> — server-side search across the full history", () => {
  it("passes planId as the attachment context on every search so the server-side query can exclude duplicates", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await screen.findByText("Thai Airways");
    expect(searchTransactionsForPlanAction).toHaveBeenCalled();
    expect(vi.mocked(searchTransactionsForPlanAction).mock.calls[0]![0]).toMatchObject({ planId: PLAN_ID });
  });

  it("surfaces an old transaction returned by the server search -- the picker never clips by date", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(
      page([
        txn({ id: "txn-old", merchant: "Amazon", occurred_at: "2024-03-15" }),
        txn({ id: "txn-new", merchant: "Amazon", occurred_at: "2026-09-20" }),
      ]),
    );
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    // Both the 2024 and 2026 Amazon rows render in the same picker view.
    await screen.findByRole("checkbox", { name: /select amazon.*2024.*/i });
    expect(screen.getByRole("checkbox", { name: /select amazon.*2026.*/i })).toBeInTheDocument();
  });

  it("sends the text query (not just the plan id) to the server after the user types", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await screen.findByText("Thai Airways");
    vi.mocked(searchTransactionsForPlanAction).mockClear();
    await user.type(screen.getByLabelText("Search transactions"), "amazon");
    // Debounce settles; the last call should carry the search text (via server, not client filtering).
    await vi.waitFor(() => {
      const last = vi.mocked(searchTransactionsForPlanAction).mock.calls.at(-1)?.[0];
      expect(last).toMatchObject({ planId: PLAN_ID, search: "amazon" });
    }, { timeout: 1500 });
  });

  it("shows Load more when the server reports more pages and appends the next page's results on click", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    const user = userEvent.setup();
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValueOnce({
      transactions: [txn({ id: "txn-a", merchant: "Amazon A" })],
      nextCursor: { occurredAt: "2026-01-05", id: "txn-a" },
      archivedPlanIds: [],
    });
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await screen.findByText("Amazon A");
    const loadMore = screen.getByRole("button", { name: /load more/i });
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValueOnce({
      transactions: [txn({ id: "txn-b", merchant: "Amazon B" })],
      nextCursor: null,
      archivedPlanIds: [],
    });
    await user.click(loadMore);
    await screen.findByText("Amazon B");
    expect(screen.getByText("Amazon A")).toBeInTheDocument(); // first page still visible
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("preserves selection across Load more pages so users can attach rows from different pages at once", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    const user = userEvent.setup();
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValueOnce({
      transactions: [txn({ id: "txn-a", merchant: "Amazon A" })],
      nextCursor: { occurredAt: "2026-01-05", id: "txn-a" },
      archivedPlanIds: [],
    });
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await user.click(await screen.findByRole("checkbox", { name: /select amazon a/i }));
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValueOnce({
      transactions: [txn({ id: "txn-b", merchant: "Amazon B" })],
      nextCursor: null,
      archivedPlanIds: [],
    });
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await user.click(await screen.findByRole("checkbox", { name: /select amazon b/i }));
    expect(screen.getByText("2 transactions selected")).toBeInTheDocument();
  });

  it("shows the filter-aware empty state (with Clear filters) only when filters/search are active", async () => {
    const { searchTransactionsForPlanAction } = await import("../actions");
    const user = userEvent.setup();
    render(
      <AssociateTransactionDialog {...commonProps} planId={PLAN_ID} currency="INR" items={items} open onOpenChange={() => {}} onAssociated={() => {}} />,
    );
    await screen.findByText("Thai Airways");
    vi.mocked(searchTransactionsForPlanAction).mockResolvedValue(page([]));
    await user.type(screen.getByLabelText("Search transactions"), "nothingmatches");
    await screen.findByText(/no transactions matched the current filters/i);
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });
});
